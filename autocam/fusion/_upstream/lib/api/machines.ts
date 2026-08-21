import { Machines } from "@/lib/db/schema/cam";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import zod from "zod";
import { registry } from "@/lib/openapi/registry";
import { apiKey, userSession } from "./auth";
import { scopeNames as scopes } from "../scopes";
import { checkUserTeam, CommonAuthorization, Conflict, IDPolicy, parseSchema, registerTeamEndpoint, routeFactory, routeResponse, ValidationError, parseFormData } from "./common";
import { teamIdFromDigest } from "../auth/server";
import { eq } from "drizzle-orm";
import { client } from "../aws";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const CreateSchema = zod.object({
  data: createInsertSchema(Machines).omit({ team_id: true }),
  file: zod.instanceof(File).openapi({ type: "string", format: "binary" })
});
const UpdateSchema = createUpdateSchema(Machines).omit({ team_id: true });
const Machine = createSelectSchema(Machines).extend({ file: zod.httpUrl() }).omit({ team_id: true }).openapi("Machine")
const MultipleMachines = zod.array(Machine.omit({ file: true }));

registerTeamEndpoint([scopes.machines.read], {
  method: "get",
  path: "/api/machines",
  tags: ["Machines"],
  summary: "Get Machines",
  responses: {
    200: {
      description: "This endpoint returns the machines from the given team",
      content: {
        "application/json": {
          schema: MultipleMachines
        }
      }
    },
    ...CommonAuthorization
  }
});

registerTeamEndpoint([scopes.machines.write], {
  method: "post",
  path: "/api/machines",
  tags: ["Machines"],
  summary: "Create Machine",
  description: "This endpoint requires the user's email to be verified",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: zod.object({
            data: CreateSchema.openapi({ description: "Machine info as stringified JSON" }),
            file: zod.instanceof(File).openapi({ type: "string", format: "binary", description: "Machine file upload" })
          })
        }
      }
    }
  },
  responses: {
    201: {
      description: "Returns the ID of the created machine",
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
  path: "/api/machines/{id}",
  tags: ["Machines"],
  summary: "Update Machine",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.machines.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the machine" }) }),
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
      description: "Machine successfully updated",
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

registry.registerPath({
  method: "delete",
  path: "/api/machine/{id}",
  tags: ["Machines"],
  summary: "Delete Machine",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.machines.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the machine" }) }),
  },
  responses: {
    204: {
      description: "Machine successfully deleted",
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

export const GET = routeFactory(async (req, authType, tx, id) => {
  id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, id);
  return routeResponse(200, await parseSchema(await tx.query.Machines.findMany({
    where: eq(Machines.team_id, id)
  }), MultipleMachines));
}, {
  user: { idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.machines.read], idPolicy: IDPolicy.Forbidden }
});

export const SingleGET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const machine = await tx.query.Machines.findFirst({
    where: eq(Machines.id, id)
  });
  if (!machine) return routeResponse(404);
  await checkUserTeam(tx, authType, machine.team_id);
  return routeResponse(200, await parseSchema({
    ...machine,
    file: await getSignedUrl(client, new GetObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      Key: `teams/${machine.team_id}/machines/${id}`
    }), { expiresIn: 120 })
  }, Machine));
}, { user: {}, apiKey: { scopes: [scopes.machines.read] } });

export const POST = routeFactory(async (req, authType, tx, team_id) => {
  team_id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, team_id, true);
  const { data, file } = await parseFormData(await req.formData(), CreateSchema);
  const [id] = await tx.insert(Machines).values({
    ...data,
    team_id
  }).returning({ id: Machines.id });

  await client.send(new PutObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${team_id}/machines/${id.id}`,
    ACL: "private",
    Body: await file.bytes(),
    ContentType: file.type
  }));

  return routeResponse(201, id);
}, {
  user: { emailVerified: true, idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.machines.write], idPolicy: IDPolicy.Forbidden }
});

export const PATCH = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const machine = await tx.query.Machines.findFirst({ where: eq(Machines.id, id) });
  await checkUserTeam(tx, authType, machine?.team_id, true);
  const body = await parseSchema(await req.json(), UpdateSchema);
  await tx.update(Machines).set(body).where(eq(Machines.id, id)).returning({ id: Machines.id });
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.machines.write] } });

export const DELETE = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const machine = await tx.query.Machines.findFirst({ where: eq(Machines.id, id) });
  if (!machine) return routeResponse(404);
  await checkUserTeam(tx, authType, machine.team_id, true);
  await tx.delete(Machines).where(eq(Machines.id, id));
  await client.send(new DeleteObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${machine.team_id}/machines/${id}`
  }));
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.machines.write] } });
