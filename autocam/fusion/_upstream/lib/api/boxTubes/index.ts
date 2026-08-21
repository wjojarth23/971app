import "./jobs";

import { BoxTubes } from "@/lib/db/schema/cam";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import zod from "zod";
import { registry } from "@/lib/openapi/registry";
import { apiKey, userSession } from "../auth";
import { scopeNames as scopes } from "../../scopes";
import { checkUserTeam, CommonAuthorization, Conflict, IDPolicy, NotFound, parseSchema, registerTeamEndpoint, routeFactory, routeResponse, ValidationError, parseFormData } from "../common";
import { teamIdFromDigest } from "../../auth/server";
import { eq } from "drizzle-orm";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { client } from "@/lib/aws";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const CreateSchema = zod.object({
  data: createInsertSchema(BoxTubes).omit({ team_id: true }),
  file: zod.instanceof(File).openapi({ type: "string", format: "binary" })
});
const UpdateSchema = createUpdateSchema(BoxTubes).omit({ team_id: true });
const BoxTube = createSelectSchema(BoxTubes).extend({ file: zod.httpUrl() }).omit({ team_id: true }).openapi("Box Tube");
const MultipleBoxTubes = zod.array(BoxTube.omit({ file: true }));

registerTeamEndpoint([scopes.boxTubes.read], {
  method: "get",
  path: "/api/boxTubes",
  tags: ["Box Tubes"],
  summary: "Get Box Tubes",
  responses: {
    200: {
      description: "This endpoint retunrs the box tubes from the team",
      content: {
        "application/json": {
          schema: MultipleBoxTubes
        }
      }
    },
    ...CommonAuthorization
  }
});

registerTeamEndpoint([scopes.boxTubes.write], {
  method: "post",
  path: "/api/boxTubes",
  tags: ["Box Tubes"],
  summary: "Create Box Tube",
  description: "This endpoint requires the user's email to be verified",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: zod.object({
            data: CreateSchema.openapi({ description: "Box tube info as stringified JSON" }),
            file: zod.instanceof(File).openapi({ type: "string", format: "binary", description: "Box tube file upload" })
          }),
        }
      }
    }
  },
  responses: {
    201: {
      description: "Returns the ID of the created box tube",
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

registry.registerPath({
  method: "patch",
  path: "/api/boxTubes/{id}",
  tags: ["Box Tubes"],
  summary: "Update Box Tube",
  description: "This endpoint requires the user's email to be verified",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.boxTubes.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the box tube" }) }),
    body: {
      content: {
        "application/json": {
          schema: UpdateSchema
        }
      }
    }
  },
  responses: {
    204: {
      description: "Box tube updated successfully",
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

registry.registerPath({
  method: "delete",
  path: "/api/boxTubes/{id}",
  tags: ["Box Tubes"],
  summary: "Delete Box Tube",
  description: "This endpoint requires the user's email to be verified",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.boxTubes.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the box tube" }) }),
  },
  responses: {
    204: {
      description: "Box tube deleted successfully",
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

export const GET = routeFactory(async (req, authType, tx, teamId) => {
  teamId ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, teamId);

  return routeResponse(200, await parseSchema(await tx.query.BoxTubes.findMany({
    where: eq(BoxTubes.team_id, teamId)
  }), MultipleBoxTubes));
}, {
  user: { idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.boxTubes.read], idPolicy: IDPolicy.Forbidden }
});

export const SingleGET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const boxTube = await tx.query.BoxTubes.findFirst({ where: eq(BoxTubes.id, id) });
  if (!boxTube) return routeResponse(404);
  await checkUserTeam(tx, authType, boxTube.team_id);
  return routeResponse(200, await parseSchema({
    ...boxTube,
    file: await getSignedUrl(client, new GetObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      Key: `teams/${boxTube.team_id}/boxTubes/${id}`
    }), { expiresIn: 120 })
  }, BoxTube));
}, { user: {}, apiKey: { scopes: [scopes.boxTubes.read] } });

export const POST = routeFactory(async (req, authType, tx, team_id) => {
  team_id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, team_id);

  const { data, file } = await parseFormData(await req.formData(), CreateSchema);
  const [id] = await tx.insert(BoxTubes).values({ ...data, team_id }).returning({ id: BoxTubes.id });
  await client.send(new PutObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${team_id}/boxTubes/${id.id}`,
    ACL: "private",
    Body: await file.bytes(),
    ContentType: file.type
  }));
  return routeResponse(201, id);
}, {
  user: { idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.boxTubes.write], idPolicy: IDPolicy.Forbidden }
});

export const PATCH = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const boxTube = await tx.query.BoxTubes.findFirst({ where: eq(BoxTubes.id, id) });
  if (!boxTube) return routeResponse(404);
  await checkUserTeam(tx, authType, boxTube.team_id);
  const body = await parseSchema(await req.json(), UpdateSchema);
  await tx.update(BoxTubes).set(body).where(eq(BoxTubes.id, id));
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.boxTubes.write] } });

export const DELETE = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const boxTube = await tx.query.BoxTubes.findFirst({ where: eq(BoxTubes.id, id) });
  if (!boxTube) return routeResponse(404);
  await checkUserTeam(tx, authType, boxTube.team_id);
  await tx.delete(BoxTubes).where(eq(BoxTubes.id, id));
  await client.send(new DeleteObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${boxTube.team_id}/boxTubes/${id}`
  }));
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.boxTubes.write] } });
