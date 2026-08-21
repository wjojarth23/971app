import zod from "zod";
import { scopeNames as scopes } from "../scopes";
import { checkUserTeam, CommonAuthorization, Conflict, IDPolicy, parseFormData, parseSchema, registerTeamEndpoint, routeFactory, routeResponse, ValidationError } from "./common";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import { ToolMachines, ToolMaterials, Tools } from "../db/schema/cam";
import { registry } from "../openapi/registry";
import { apiKey, userSession } from "./auth";
import { teamIdFromDigest } from "../auth/server";
import { and, eq, notInArray } from "drizzle-orm";
import { client } from "../aws";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const CreateSchema = zod.object({
  data: createInsertSchema(Tools).omit({ team_id: true, default_selected: true }),
  file: zod.instanceof(File).openapi({ type: "string", format: "binary" })
});
const UpdateSchema = createUpdateSchema(Tools).extend({
  machine_ids: zod.array(zod.number()).optional(),
  material_ids: zod.array(zod.number()).optional()
}).omit({ team_id: true });
const Tool = createSelectSchema(Tools).extend({
  file: zod.httpUrl(),
  machine_ids: zod.array(zod.number()),
  material_ids: zod.array(zod.number())
}).omit({ team_id: true }).openapi("Tool");
const MultipleTools = zod.array(Tool.omit({ file: true }));

registerTeamEndpoint([scopes.tools.read], {
  method: "get",
  path: "/api/tools",
  tags: ["Tools"],
  summary: "Get Tools",
  responses: {
    200: {
      description: "This endpoint returns the tools from the given team",
      content: {
        "application/json": {
          schema: MultipleTools
        }
      }
    },
    ...CommonAuthorization
  }
});

registry.registerPath({
  method: "get",
  path: "/api/tools/{id}",
  tags: ["Tools"],
  summary: "Get Tool",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.tools.read] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "Tool ID" }) })
  },
  responses: {
    200: {
      description: "This endpoint returns the tool with a presigned URL for downloading the tool that is valid for 1 minute",
      content: {
        "application/json": {
          schema: Tool
        }
      }
    },
    ...CommonAuthorization,
    ...ValidationError,
  }
})

registerTeamEndpoint([scopes.tools.write], {
  method: "post",
  path: "/api/tools",
  tags: ["Tools"],
  summary: "Create Tool",
  description: "This endpoint requires the user's email to be verified",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: zod.object({
            data: CreateSchema.openapi({ description: "Tool info as stringified JSON" }),
            file: zod.instanceof(File).openapi({ type: "string", format: "binary", description: "Tool file upload" })
          })
        }
      }
    }
  },
  responses: {
    201: {
      description: "Returns the ID of the created tool",
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
  path: "/api/tools/{id}",
  tags: ["Tools"],
  summary: "Update Tool",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.tools.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the tool" }) }),
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
      description: "Tool successfully updated"
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

registry.registerPath({
  method: "delete",
  path: "/api/tools/{id}",
  tags: ["Tools"],
  summary: "Delete Tool",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.tools.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the tool" }) })
  },
  responses: {
    204: {
      description: "Tool successfully deleted",
      ...CommonAuthorization,
      ...ValidationError
    }
  }
});

export const GET = routeFactory(async (req, authType, tx, id) => {
  id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, id);
  return routeResponse(200, await parseSchema((await tx.query.Tools.findMany({
    where: eq(Tools.team_id, id),
    with: { machines: true, materials: true }
  })).map(x => ({
    ...x,
    material_ids: x.materials.map(m => m.material_id),
    machine_ids: x.machines.map(m => m.machine_id)
  })), MultipleTools));
}, {
  user: { idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.tools.read], idPolicy: IDPolicy.Forbidden }
});

export const SingleGET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const tool = await tx.query.Tools.findFirst({
    where: eq(Tools.id, id),
    with: { machines: true, materials: true }
  });
  if (!tool) return routeResponse(404);
  await checkUserTeam(tx, authType, tool.team_id);
  return routeResponse(200, await parseSchema({
    ...tool,
    material_ids: tool.materials.map(x => x.material_id),
    machine_ids: tool.machines.map(x => x.machine_id),
    file: await getSignedUrl(client, new GetObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      Key: `teams/${tool.team_id}/tools/${id}`
    }), { expiresIn: 120 })
  }, Tool));
}, { user: {}, apiKey: { scopes: [scopes.tools.read] } });

export const POST = routeFactory(async (req, authType, tx, team_id) => {
  team_id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, team_id, true);
  const { data, file } = await parseFormData(await req.formData(), CreateSchema);
  const [id] = await tx.insert(Tools).values({ ...data, team_id }).returning({ id: Tools.id });
  await client.send(new PutObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${team_id}/tools/${id.id}`,
    ACL: "private",
    Body: await file.bytes(),
    ContentType: file.type
  }));
  return routeResponse(201, id);
}, {
  user: { emailVerified: true, idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.tools.write], idPolicy: IDPolicy.Forbidden }
});

export const PATCH = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const tool = await tx.query.Tools.findFirst({ where: eq(Tools.id, id) });
  await checkUserTeam(tx, authType, tool?.team_id, true);
  const { machine_ids, material_ids, ...body } = await parseSchema(await req.json(), UpdateSchema);
  if (machine_ids !== undefined) {
    await tx.delete(ToolMachines).where(and(
      eq(ToolMachines.tool_id, id),
      notInArray(ToolMachines.machine_id, machine_ids)
    ));
    if (machine_ids.length > 0)
      await tx.insert(ToolMachines).values(machine_ids.map(x => ({ machine_id: x, tool_id: id }))).onConflictDoNothing();
  }
  if (material_ids !== undefined) {
    await tx.delete(ToolMaterials).where(and(
      eq(ToolMaterials.tool_id, id),
      notInArray(ToolMaterials.material_id, material_ids)
    ));
    if (material_ids.length > 0)
      await tx.insert(ToolMaterials).values(material_ids.map(x => ({ material_id: x, tool_id: id }))).onConflictDoNothing();
  }
  if (Object.keys(body).length > 0)
    await tx.update(Tools).set(body).where(eq(Tools.id, id)).returning({ id: Tools.id });
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.tools.write] } });

export const DELETE = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const tool = await tx.query.Tools.findFirst({ where: eq(Tools.id, id) });
  if (!tool) return routeResponse(404);
  await checkUserTeam(tx, authType, tool.team_id, true);
  await tx.delete(Tools).where(eq(Tools.id, id));
  await client.send(new DeleteObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${tool.team_id}/tools/${id}`
  }));
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.tools.write] } });

// Tool Library JSON schemas
const ToolLibrarySchema = zod.object({
  data: zod.array(zod.record(zod.string(), zod.unknown())),
  version: zod.number()
}).passthrough();

const UpdateLibrarySchema = zod.object({
  data: zod.array(zod.record(zod.string(), zod.unknown())),
  version: zod.number()
});

// OpenAPI registration for library endpoints
registry.registerPath({
  method: "get",
  path: "/api/tools/{id}/library",
  tags: ["Tools"],
  summary: "Get Tool Library JSON",
  description: "Returns the parsed JSON content of the tool library file",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.tools.read] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "Tool ID" }) })
  },
  responses: {
    200: {
      description: "Tool library JSON content",
      content: {
        "application/json": {
          schema: ToolLibrarySchema
        }
      }
    },
    ...CommonAuthorization,
    ...ValidationError,
  }
});

registry.registerPath({
  method: "put",
  path: "/api/tools/{id}/library",
  tags: ["Tools"],
  summary: "Update Tool Library JSON",
  description: "Updates the tool library JSON file. Requires email verification.",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.tools.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "Tool ID" }) }),
    body: {
      content: {
        "application/json": {
          schema: UpdateLibrarySchema
        }
      }
    }
  },
  responses: {
    204: {
      description: "Tool library successfully updated"
    },
    ...CommonAuthorization,
    ...ValidationError,
  }
});

// Get parsed tool library JSON
export const LibraryGET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const tool = await tx.query.Tools.findFirst({
    where: eq(Tools.id, id)
  });
  if (!tool) return routeResponse(404);
  await checkUserTeam(tx, authType, tool.team_id);

  // Fetch the JSON file from S3
  const response = await client.send(new GetObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${tool.team_id}/tools/${id}`
  }));

  if (!response.Body) {
    return routeResponse(404, { error: "Tool library file not found" });
  }

  const bodyString = await response.Body.transformToString();
  const libraryData = JSON.parse(bodyString);

  return routeResponse(200, libraryData);
}, { user: {}, apiKey: { scopes: [scopes.tools.read] } });

// Update tool library JSON
export const LibraryPUT = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const tool = await tx.query.Tools.findFirst({
    where: eq(Tools.id, id)
  });
  if (!tool) return routeResponse(404);
  await checkUserTeam(tx, authType, tool.team_id, true);

  const body = await parseSchema(await req.json(), UpdateLibrarySchema);

  // Upload the updated JSON to S3
  await client.send(new PutObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${tool.team_id}/tools/${id}`,
    ACL: "private",
    Body: JSON.stringify(body, null, 2),
    ContentType: "application/json"
  }));

  return routeResponse(204);
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.tools.write] } });
