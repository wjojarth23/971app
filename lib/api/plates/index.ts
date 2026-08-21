import { PartCategories, Plates } from "@/lib/db/schema/cam";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import zod from "zod";
import { registry } from "@/lib/openapi/registry";
import { apiKey, userSession } from "../auth";
import { scopeNames as scopes } from "../../scopes";
import { checkUserTeam, CommonAuthorization, Conflict, NotFound, parseSchema, routeFactory, routeResponse, ValidationError } from "../common";
import { eq } from "drizzle-orm";

import "./jobs";

type PlateCategoryRef = { team_id: number };

const CreateSchema = createInsertSchema(Plates).omit({ category_id: true });
const UpdateSchema = createUpdateSchema(Plates).omit({ category_id: true });
const Plate = createSelectSchema(Plates).omit({ category_id: true }).openapi("Plate");
const PlateWithCategory = createSelectSchema(Plates).omit({ category_id: true }).extend({
  category: zod.object({
    thickness: zod.number(),
    material: zod.string()
  })
}).openapi("PlateWithCategory");

registry.registerPath({
  method: "get",
  path: "/api/pc/{id}/plates",
  tags: ["Plates"],
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.plates.read] }
  ],
  summary: "Get Plates",
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the part category" }) })
  },
  responses: {
    200: {
      description: "This endpoint returns the plates from the given part category",
      content: {
        "application/json": {
          schema: zod.array(Plate)
        }
      }
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

registry.registerPath({
  method: "post",
  path: "/api/pc/{id}/plates",
  tags: ["Plates"],
  summary: "Create Plate",
  description: "This endpoint requires the user's email to be verified",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.plates.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the part category" }) }),
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
      description: "Returns the ID of the created plate",
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
  method: "get",
  path: "/api/plates/{id}",
  tags: ["Plates"],
  summary: "Get Plate",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.plates.read] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the plate" }) })
  },
  responses: {
    200: {
      description: "Returns the plate with category information",
      content: {
        "application/json": {
          schema: PlateWithCategory
        }
      }
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

registry.registerPath({
  method: "patch",
  path: "/api/plates/{id}",
  tags: ["Plates"],
  summary: "Update Plate",
  description: "This endpoint requires the user's email to be verified",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.plates.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the plate" }) }),
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
      description: "Plate updated successfully",
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

registry.registerPath({
  method: "delete",
  path: "/api/plates/{id}",
  tags: ["Plates"],
  summary: "Delete Plate",
  description: "This endpoint requires the user's email to be verified",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.plates.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the plate" }) }),
  },
  responses: {
    204: {
      description: "Plate deleted successfully",
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

export const GET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const pc = await tx.query.PartCategories.findFirst({ where: eq(PartCategories.id, id) });
  await checkUserTeam(tx, authType, pc?.team_id);
  return routeResponse(200, await parseSchema(await tx.query.Plates.findMany({
    where: eq(Plates.category_id, id)
  }), zod.array(Plate)));
}, { user: {}, apiKey: { scopes: [scopes.plates.read] } });

export const SingleGET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  const plate = await tx.query.Plates.findFirst({
    where: eq(Plates.id, id),
    with: { category: true }
  });
  if (!plate) return routeResponse(404);
  await checkUserTeam(
    tx,
    authType,
    (plate.category as PlateCategoryRef | null)?.team_id
  );
  return routeResponse(200, await parseSchema(plate, PlateWithCategory));
}, { user: {}, apiKey: { scopes: [scopes.plates.read] } });

export const POST = routeFactory(async (req, authType, tx, category_id) => {
  if (!category_id) return routeResponse(422);
  const pc = await tx.query.PartCategories.findFirst({ where: eq(PartCategories.id, category_id) });
  await checkUserTeam(tx, authType, pc?.team_id);
  const data = await parseSchema(await req.json(), CreateSchema);
  const [id] = await tx.insert(Plates).values({ ...data, category_id }).returning({ id: Plates.id });
  return routeResponse(201, id);
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.plates.write] } });

export const PATCH = routeFactory(async (req, authType, tx, id) => {
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
  const body = await parseSchema(await req.json(), UpdateSchema);
  await tx.update(Plates).set(body).where(eq(Plates.id, id)).returning({ id: Plates.id });
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.plates.write] } });

export const DELETE = routeFactory(async (req, authType, tx, id) => {
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
  await tx.delete(Plates).where(eq(Plates.id, id));
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.plates.write] } });
