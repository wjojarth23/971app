import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { JobKind, Jobs } from "../db/schema/cam";
import { TeamKeys } from "../db/schema/entities";
import zod, { ZodType } from "zod";
import { createSelectSchema, Json } from "drizzle-zod";
import { client } from "../aws";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { scopeNames as scopes } from "../scopes";
import { teamIdFromDigest } from "../auth/server";
import { Transaction } from "../db";
import { routeFactory, routeResponse, parseSchema, checkUserTeam, parseFormData } from "./common";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const RequestSchema = createSelectSchema(Jobs).pick({ id: true, kind: true, payload: true });
export const Job = createSelectSchema(Jobs).extend({
  queue_position: zod.number().nullable()
}).omit({ team_id: true }).transform(({ queue_position, ...x }) => {
  let status = "pending";
  if (x.claimed_by) status = "in progress";
  if (x.response !== null) status = "completed";
  if (queue_position === null) return { ...x, status };
  return { ...x, status, queue_position };
}).openapi("Job");

const SuccessJobResponse = zod.object({
  file: zod.instanceof(File),
  data: zod.strictObject({})
})

const CamSuccessJobResponse = zod.object({
  file: zod.instanceof(File),
  data: zod.strictObject({
    total_machining_time: zod.number().nonnegative().optional()
  })
})

const ErrorJobResponse = zod.object({
  data: zod.object({
    error: zod.string()
  })
});

const PartQuantitySchema = zod.object({
  part_id: zod.number(),
  quantity: zod.number()
});

const JobResponses = {
  "box_tube": zod.union([CamSuccessJobResponse, ErrorJobResponse]),
  "plate:cam": zod.union([CamSuccessJobResponse, ErrorJobResponse]),
  "plate:arrange": zod.union([SuccessJobResponse, ErrorJobResponse.extend({
    data: ErrorJobResponse.shape.data.extend({
      excess_parts: zod.array(PartQuantitySchema),
      oversized_parts: zod.array(PartQuantitySchema).optional()
    })
  })])
} as const satisfies Record<(typeof JobKind.enumValues)[number], ZodType>;

export function queuePositionSubquery(tx: Transaction) {
  const subquery = tx.select({
    id: Jobs.id,
    queue_position: sql<number>`ROW_NUMBER() OVER (
      PARTITION BY ${Jobs.team_id}
      ORDER BY ${Jobs.created_at} ASC
    )`.mapWith(Number).as("queue_position")
  }).from(Jobs).where(isNull(Jobs.claimed_by)).as('queue_position');
  return tx.select({
    ...getTableColumns(Jobs),
    queue_position: subquery.queue_position
  }).from(Jobs).leftJoin(subquery, eq(Jobs.id, subquery.id)).as("job");
}

export const SingleGET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const subquery = queuePositionSubquery(tx);
  const jobs = await tx.select()
    .from(subquery)
    .where(eq(subquery.id, id));
  if (jobs.length === 0) return routeResponse(404);
  const [job] = jobs;
  await checkUserTeam(tx, authType, job.team_id);
  return routeResponse(200, {
    // FIXME: Move file into schema and move parseJsonBody up a level
    ...await parseSchema(job, Job),
    file: await getSignedUrl(client, new GetObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      Key: `teams/${job.team_id}/jobs/${id}`
    }), { expiresIn: 120 })
  })
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.jobs.read] } });

export const Request = routeFactory(async (req, authType, tx) => {
  if (!authType.keyDigest) return routeResponse(401);
  const teamId = await teamIdFromDigest(tx, authType);
  // Update last_activity timestamp for this API key
  await tx.update(TeamKeys).set({ last_activity: new Date() }).where(eq(TeamKeys.digest, authType.keyDigest));
  const result = await tx.update(Jobs).set({ claimed_by: authType.keyDigest })
    .where(eq(Jobs.id, tx.select({ id: Jobs.id })
      .from(Jobs).where(and(eq(Jobs.team_id, teamId), isNull(Jobs.claimed_by)))
      .orderBy(asc(Jobs.created_at))
      .for("update", { skipLocked: true }).limit(1))).returning();
  if (result.length === 0) return routeResponse(204);
  const [job] = result;
  return routeResponse(200, await parseSchema(job, RequestSchema));
}, { apiKey: { scopes: [scopes.jobs.process] } });

export const Complete = routeFactory(async (req, authType, tx) => {
  if (!authType.keyDigest) return routeResponse(401);
  const job = await tx.query.Jobs.findFirst({
    where: and(
      eq(Jobs.claimed_by, authType.keyDigest),
      isNull(Jobs.response)
    )
  });
  if (!job) return routeResponse(404);
  const body = await parseFormData(await req.formData(), JobResponses[job.kind]);
  const result = await tx.update(Jobs).set({ response: body.data }).where(eq(Jobs.id, job.id));
  if (result.rowCount === 0) return routeResponse(404);
  if ("file" in body) {
    await client.send(new PutObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      Key: `teams/${job.team_id}/jobs/${job.id}`,
      ACL: "private",
      Body: await body.file.bytes(),
      ContentType: body.file.type
    }));
  }
  return routeResponse(204);
}, { apiKey: { scopes: [scopes.jobs.process] } });

export const DELETE = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const job = await tx.query.Jobs.findFirst({ where: eq(Jobs.id, id) });
  if (!job) return routeResponse(404);
  await checkUserTeam(tx, authType, job.team_id);

  await tx.delete(Jobs).where(eq(Jobs.id, id));
  await client.send(new DeleteObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${job.team_id}/jobs/${id}`
  }));
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.jobs.delete] } });
