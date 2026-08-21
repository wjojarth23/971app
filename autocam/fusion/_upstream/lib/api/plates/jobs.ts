import { Jobs, PartCategoryAssignments, PlateJobs, Plates } from "@/lib/db/schema/cam";
import { eq } from "drizzle-orm";
import zod from "zod";
import { registry } from "@/lib/openapi/registry";
import { apiKey, userSession } from "../auth";
import { scopeNames as scopes } from "@/lib/scopes";
import { checkUserTeam, CommonAuthorization, Conflict, parseSchema, routeFactory, routeResponse, ValidationError } from "../common";
import { Job, queuePositionSubquery } from "../jobs";

type PlateCategoryRef = { team_id: number };

const CreateSchema = zod.discriminatedUnion("type", [
  zod.object({ type: zod.literal("arrange") }),
  zod.object({
    type: zod.literal("cam"),
    machine_id: zod.number(),
    tool_ids: zod.array(zod.number()),
    tool_items: zod.array(zod.object({
      tool_id: zod.number(),
      tool_guid: zod.string()
    })).optional()
  })
]);

const JobSchema = Job.transform(x => ({ ...x, kind: x.kind.replace(/^(plate:)/, "") }));

registry.registerPath({
  method: "get",
  path: "/api/plates/{id}/jobs",
  tags: ["Plate Jobs"],
  summary: "Get Plate Jobs",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.jobs.read] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "Plate ID" }) })
  },
  responses: {
    200: {
      description: "This endpoint returns the plate jobs for a given plate",
      content: {
        "application/json": {
          schema: zod.array(JobSchema)
        }
      }
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

registry.registerPath({
  method: "post",
  path: "/api/plates/{id}/jobs",
  tags: ["Plate Jobs"],
  summary: "Create Plate Job",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.jobs.create] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "Plate ID" }) }),
    body: {
      content: {
        "application/json": {
          schema: CreateSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: "Returns the ID of the created plate job",
      content: {
        "application/json": {
          schema: zod.object({ id: zod.number() })
        }
      }
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...Conflict
  }
});

export const GET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const plate = await tx.query.Plates.findFirst({
    where: eq(Plates.id, id),
    with: { category: true }
  });
  await checkUserTeam(
    tx,
    authType,
    (plate?.category as PlateCategoryRef | null)?.team_id
  );
  const subquery = queuePositionSubquery(tx);
  const result = (await tx.select().from(PlateJobs)
    .innerJoin(subquery, eq(PlateJobs.job_id, subquery.id))
    .where(eq(PlateJobs.plate_id, id))).map(x => x.job);
  return routeResponse(200, await parseSchema(result, zod.array(JobSchema)));
}, { user: {}, apiKey: { scopes: [scopes.jobs.read] } });

export const POST = routeFactory(async (req, authType, tx, plate_id) => {
  if (!plate_id) return routeResponse(422);
  const plate = await tx.query.Plates.findFirst({
    where: eq(Plates.id, plate_id),
    with: { category: true }
  });
  if (!plate) return routeResponse(404);
  await checkUserTeam(
    tx,
    authType,
    (plate?.category as PlateCategoryRef | null)?.team_id
  );
  const body = await parseSchema(await req.json(), CreateSchema);

  const { type, ...payload } = body;
  const assignments = await tx.query.PartCategoryAssignments.findMany({
    where: eq(PartCategoryAssignments.plate_id, plate_id),
    columns: { part_id: true, quantity: true }
  });
  const [id] = await tx.insert(Jobs).values({
    team_id: (plate.category as PlateCategoryRef).team_id,
    kind: `plate:${type}`,
    payload: { ...payload, assignments, plate_id }
  }).returning({ id: Jobs.id });
  // Create plate job
  await tx.insert(PlateJobs).values({ job_id: id.id, plate_id });
  return routeResponse(201, id);
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.jobs.create] } });
