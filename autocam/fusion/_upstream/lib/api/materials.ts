import { Materials } from "@/lib/db/schema/core";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import zod from "zod";
import { registry } from "@/lib/openapi/registry";
import { apiKey, userSession } from "./auth";
import { scopeNames as scopes } from "../scopes";
import { checkUserTeam, CommonAuthorization, Conflict, IDPolicy, parseSchema, registerTeamEndpoint, routeFactory, routeResponse, ValidationError } from "./common";
import { teamIdFromDigest } from "../auth/server";
import { eq } from "drizzle-orm";

const CreateSchema = createInsertSchema(Materials).omit({ team_id: true });
const UpdateSchema = createUpdateSchema(Materials).omit({ team_id: true });
const Material = createSelectSchema(Materials).omit({ team_id: true }).openapi("Material")

registerTeamEndpoint([scopes.materials.read], {
  method: "get",
  path: "/api/materials",
  tags: ["Materials"],
  summary: "Get Materials",
  responses: {
    200: {
      description: "This endpoint returns the materials from the given team",
      content: {
        "application/json": {
          schema: zod.array(Material)
        }
      }
    },
    ...CommonAuthorization,
  }
});

registerTeamEndpoint([scopes.materials.write], {
  method: "post",
  path: "/api/materials",
  tags: ["Materials"],
  summary: "Create Material",
  description: "This endpoint requires the user's email to be verified",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: zod.object({
            data: CreateSchema.openapi({ description: "Material info as stringified JSON" }),
            file: zod.instanceof(File).openapi({ type: "string", format: "binary", description: "Material file upload" })
          })
        }
      }
    }
  },
  responses: {
    201: {
      description: "Returns the ID of the created material",
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
  path: "/api/materials/{id}",
  tags: ["Materials"],
  summary: "Update Material",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.materials.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the material" }) }),
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
      description: "Material successfully updated",
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

registry.registerPath({
  method: "delete",
  path: "/api/material/{id}",
  tags: ["Materials"],
  summary: "Delete Material",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.materials.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the material" }) }),
  },
  responses: {
    204: {
      description: "Material successfully deleted",
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

export const GET = routeFactory(async (req, authType, tx, id) => {
  id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, id);
  return routeResponse(200, await parseSchema(await tx.query.Materials.findMany({
    where: eq(Materials.team_id, id)
  }), zod.array(Material)));
}, {
  user: { idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.materials.read], idPolicy: IDPolicy.Forbidden }
});

export const SingleGET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const material = await tx.query.Materials.findFirst({ where: eq(Materials.id, id) });
  if (!material) return routeResponse(404);
  await checkUserTeam(tx, authType, material.team_id);
  return routeResponse(200, await parseSchema(material, Material));
}, { user: {}, apiKey: { scopes: [scopes.materials.read] } });

export const POST = routeFactory(async (req, authType, tx, team_id) => {
  team_id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, team_id, true);
  const body = await parseSchema(await req.json(), CreateSchema);

  const [id] = await tx.insert(Materials).values({ ...body, team_id }).returning({ id: Materials.id });
  return routeResponse(201, id);
}, {
  user: { emailVerified: true, idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.materials.write], idPolicy: IDPolicy.Forbidden }
});

export const PATCH = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const material = await tx.query.Materials.findFirst({ where: eq(Materials.id, id) });
  await checkUserTeam(tx, authType, material?.team_id, true);
  const body = await parseSchema(await req.json(), createUpdateSchema(Materials));

  const result = await tx.update(Materials).set(body).where(eq(Materials.id, id));
  return routeResponse(result.rowCount === 0 ? 404 : 204);
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.materials.write] } });

export const DELETE = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const material = await tx.query.Materials.findFirst({ where: eq(Materials.id, id) });
  await checkUserTeam(tx, authType, material?.team_id, true);
  await tx.delete(Materials).where(eq(Materials.id, id));
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.materials.write] } });
