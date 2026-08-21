import { BoxTubeJobs, BoxTubes, Jobs } from "@/lib/db/schema/cam";
import { eq } from "drizzle-orm";
import zod from "zod";
import { registry } from "@/lib/openapi/registry";
import { checkUserTeam, CommonAuthorization, Conflict, parseSchema, routeFactory, routeResponse, ValidationError } from "../common";
import { apiKey, userSession } from "../auth";
import { scopeNames as scopes } from "@/lib/scopes";
import { Job, queuePositionSubquery } from "../jobs";

const CreateSchema = zod.object({
  machine_id: zod.number(),
  tool_ids: zod.array(zod.number()),
  tool_items: zod
    .array(
      zod.object({
        tool_id: zod.number(),
        tool_guid: zod.string()
      })
    )
    .optional(),
  orientation: zod
    .string()
    .transform((value) => value.trim().toLowerCase())
    .pipe(zod.enum(["vertical", "horizontal"]))
    .optional(),
  material_id: zod.number().optional(),
});

const JobSchema = Job.transform(({ kind, ...rest }) => {
  void kind;
  return rest;
});

registry.registerPath({
  method: "get",
  path: "/api/boxTubes/{id}/jobs",
  tags: ["Box Tube Jobs"],
  summary: "Get Box Tube Jobs",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.jobs.read] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "Box tube ID" }) })
  },
  responses: {
    200: {
      description: "This endpoint returns the box tube jobs for a given box tube",
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
  path: "/api/boxTubes/{id}/jobs",
  tags: ["Box Tube Jobs"],
  summary: "Create Box Tube Job",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.jobs.create] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "Box tube ID" }) }),
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
      description: "Returns the ID of the created box tube job",
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
  const tube = await tx.query.BoxTubes.findFirst({ where: eq(BoxTubes.id, id) });
  await checkUserTeam(tx, authType, tube?.team_id);
  const subquery = queuePositionSubquery(tx);
  const result = (await tx.select().from(BoxTubeJobs)
    .innerJoin(subquery, eq(BoxTubeJobs.job_id, subquery.id))
    .where(eq(BoxTubeJobs.box_tube_id, id))).map(x => x.job);
  return routeResponse(200, await parseSchema(result, zod.array(JobSchema)));
}, { user: {}, apiKey: { scopes: [scopes.jobs.read] } });

export const POST = routeFactory(async (req, authType, tx, box_tube_id) => {
  if (!box_tube_id) return routeResponse(422);
  const tube = await tx.query.BoxTubes.findFirst({ where: eq(BoxTubes.id, box_tube_id) });
  if (!tube) return routeResponse(404);
  await checkUserTeam(tx, authType, tube.team_id);

  const payload = await parseSchema(await req.json(), CreateSchema);

  const [id] = await tx.insert(Jobs).values({
    team_id: tube.team_id,
    kind: "box_tube",
    payload: { ...payload, box_tube_id }
  }).returning({ id: Jobs.id });
  await tx.insert(BoxTubeJobs).values({ job_id: id.id, box_tube_id });
  return routeResponse(201, id);
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.jobs.create] } });
