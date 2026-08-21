import { Drafts, PartCategories, Parts, BoxTubes } from "@/lib/db/schema/cam";
import { Teams } from "@/lib/db/schema/core";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import zod from "zod";
import { registry } from "@/lib/openapi/registry";
import { apiKey, userSession } from "./auth";
import { scopeNames as scopes } from "../scopes";
import { checkUserTeam, CommonAuthorization, IDPolicy, NotFound, parseSchema, registerTeamEndpoint, routeFactory, routeResponse, ValidationError, parseFormData } from "./common";
import { teamIdFromDigest } from "../auth/server";
import { count, eq } from "drizzle-orm";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { client } from "@/lib/aws";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// Pending category schema for inline category creation
const PendingCategorySchema = zod.object({
  material: zod.string(),
  thickness: zod.number().positive()
});

// Create schema - file is optional, data fields are optional
const CreateSchema = zod.object({
  data: zod.object({
    type: zod.enum(["part", "box_tube"]),
    name: zod.string().optional(),
    epic: zod.string().optional(),
    ticket: zod.string().optional(),
    quantity: zod.number().positive().optional(),
    category_id: zod.number().optional(),
    pending_category: PendingCategorySchema.optional()
  }),
  file: zod.instanceof(File).optional()
});

// Update schema - all fields optional
const UpdateSchema = zod.object({
  name: zod.string().nullable().optional(),
  epic: zod.string().nullable().optional(),
  ticket: zod.string().nullable().optional(),
  quantity: zod.number().positive().nullable().optional(),
  category_id: zod.number().nullable().optional(),
  pending_category: PendingCategorySchema.nullable().optional()
});

// Response schemas
const Draft = createSelectSchema(Drafts).extend({
  file: zod.httpUrl().optional(),
  pending_category: PendingCategorySchema.nullable()
}).omit({ team_id: true, user_id: true }).openapi("Draft");

const MultipleDrafts = zod.array(Draft.omit({ file: true }));

const DraftCount = zod.object({ count: zod.number() });

// OpenAPI registrations

// GET /api/teams/{id}/drafts - List drafts for team
registerTeamEndpoint([scopes.drafts.read], {
  method: "get",
  path: "/api/drafts",
  tags: ["Drafts"],
  summary: "Get Drafts",
  responses: {
    200: {
      description: "Returns all drafts for the team",
      content: {
        "application/json": {
          schema: MultipleDrafts
        }
      }
    },
    ...CommonAuthorization
  }
});

// GET /api/teams/{id}/drafts/count - Get draft count for badge
registerTeamEndpoint([scopes.drafts.read], {
  method: "get",
  path: "/api/drafts/count",
  tags: ["Drafts"],
  summary: "Get Draft Count",
  responses: {
    200: {
      description: "Returns the number of drafts for the team",
      content: {
        "application/json": {
          schema: DraftCount
        }
      }
    },
    ...CommonAuthorization
  }
});

// POST /api/teams/{id}/drafts - Create draft
registerTeamEndpoint([scopes.drafts.write], {
  method: "post",
  path: "/api/drafts",
  tags: ["Drafts"],
  summary: "Create Draft",
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: zod.object({
            data: CreateSchema.shape.data.openapi({ description: "Draft info as stringified JSON" }),
            file: zod.instanceof(File).optional().openapi({ type: "string", format: "binary", description: "Draft file upload (optional)" })
          })
        }
      }
    }
  },
  responses: {
    201: {
      description: "Returns the ID of the created draft",
      content: {
        "application/json": {
          schema: zod.object({ id: zod.number() })
        }
      }
    },
    ...CommonAuthorization,
    ...ValidationError
  }
});

// GET /api/drafts/{id} - Get single draft
registry.registerPath({
  method: "get",
  path: "/api/drafts/{id}",
  tags: ["Drafts"],
  summary: "Get Draft",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.drafts.read] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the draft" }) })
  },
  responses: {
    200: {
      description: "Returns the draft with file URL",
      content: {
        "application/json": {
          schema: Draft
        }
      }
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

// PATCH /api/drafts/{id} - Update draft
registry.registerPath({
  method: "patch",
  path: "/api/drafts/{id}",
  tags: ["Drafts"],
  summary: "Update Draft",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.drafts.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the draft" }) }),
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
      description: "Draft updated successfully"
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

// PATCH /api/drafts/{id}/file - Update draft file
registry.registerPath({
  method: "patch",
  path: "/api/drafts/{id}/file",
  tags: ["Drafts"],
  summary: "Update Draft File",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.drafts.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the draft" }) }),
    body: {
      content: {
        "multipart/form-data": {
          schema: zod.object({
            file: zod.instanceof(File).openapi({ type: "string", format: "binary", description: "New file for draft" })
          })
        }
      }
    }
  },
  responses: {
    204: {
      description: "Draft file updated successfully"
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

// DELETE /api/drafts/{id} - Delete draft
registry.registerPath({
  method: "delete",
  path: "/api/drafts/{id}",
  tags: ["Drafts"],
  summary: "Delete Draft",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.drafts.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the draft" }) })
  },
  responses: {
    204: {
      description: "Draft deleted successfully"
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

// POST /api/drafts/{id}/finalize - Convert draft to Part or BoxTube
registry.registerPath({
  method: "post",
  path: "/api/drafts/{id}/finalize",
  tags: ["Drafts"],
  summary: "Finalize Draft",
  description: "Converts a complete draft into an actual Part or BoxTube",
  security: [
    { [userSession.name]: [] },
    { [apiKey.name]: [scopes.drafts.write] }
  ],
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the draft" }) })
  },
  responses: {
    200: {
      description: "Draft finalized successfully",
      content: {
        "application/json": {
          schema: zod.object({
            type: zod.enum(["part", "box_tube"]),
            id: zod.number()
          })
        }
      }
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

// Route implementations

// GET /api/teams/{id}/drafts
export const GET = routeFactory(async (req, authType, tx, teamId) => {
  teamId ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, teamId);

  const drafts = await tx.query.Drafts.findMany({
    where: eq(Drafts.team_id, teamId)
  });

  return routeResponse(200, await parseSchema(drafts, MultipleDrafts));
}, {
  user: { idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.drafts.read], idPolicy: IDPolicy.Forbidden }
});

// GET /api/teams/{id}/drafts/count
export const COUNT = routeFactory(async (req, authType, tx, teamId) => {
  teamId ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, teamId);

  const result = await tx.select({ count: count() })
    .from(Drafts)
    .where(eq(Drafts.team_id, teamId));

  return routeResponse(200, { count: result[0].count });
}, {
  user: { idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.drafts.read], idPolicy: IDPolicy.Forbidden }
});

// POST /api/teams/{id}/drafts
export const POST = routeFactory(async (req, authType, tx, team_id) => {
  team_id ??= await teamIdFromDigest(tx, authType);
  await checkUserTeam(tx, authType, team_id);

  let user_id = authType.userId;
  if (!user_id) {
    const owner = await tx.query.Teams.findFirst({
      where: eq(Teams.id, team_id),
      columns: { owner: true }
    });
    user_id = owner?.owner ?? undefined;
    if (!user_id) {
      return routeResponse(401, { message: "Unable to determine user for draft creation" });
    }
  }

  const formData = await req.formData();
  const dataStr = formData.get("data");
  const file = formData.get("file") as File | null;

  if (!dataStr || typeof dataStr !== "string") {
    return routeResponse(422, { message: "Missing data field" });
  }

  const data = await parseSchema(JSON.parse(dataStr), CreateSchema.shape.data);

  const [draft] = await tx.insert(Drafts).values({
    team_id,
    user_id,
    type: data.type,
    name: data.name ?? null,
    epic: data.epic ?? null,
    ticket: data.ticket ?? null,
    quantity: data.quantity ?? null,
    category_id: data.category_id ?? null,
    pending_category: data.pending_category ?? null,
    has_file: !!file,
    file_name: file?.name ?? null,
    file_type: file?.type ?? null
  }).returning({ id: Drafts.id });

  if (file) {
    await client.send(new PutObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      Key: `teams/${team_id}/drafts/${draft.id}`,
      ACL: "private",
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: file.type
    }));
  }

  return routeResponse(201, draft);
}, {
  user: { idPolicy: IDPolicy.Required },
  apiKey: { scopes: [scopes.drafts.write], idPolicy: IDPolicy.Forbidden }
});

// GET /api/drafts/{id}
export const SingleGET = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);

  const draft = await tx.query.Drafts.findFirst({
    where: eq(Drafts.id, id)
  });

  if (!draft) return routeResponse(404);
  await checkUserTeam(tx, authType, draft.team_id);

  let fileUrl: string | undefined;
  if (draft.has_file) {
    fileUrl = await getSignedUrl(client, new GetObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      Key: `teams/${draft.team_id}/drafts/${id}`
    }), { expiresIn: 120 });
  }

  return routeResponse(200, await parseSchema({
    ...draft,
    file: fileUrl
  }, Draft));
}, { user: {}, apiKey: { scopes: [scopes.drafts.read] } });

// PATCH /api/drafts/{id}
export const PATCH = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);

  const draft = await tx.query.Drafts.findFirst({
    where: eq(Drafts.id, id)
  });

  if (!draft) return routeResponse(404);
  await checkUserTeam(tx, authType, draft.team_id);

  const body = await parseSchema(await req.json(), UpdateSchema);

  await tx.update(Drafts).set({
    ...body,
    updated_at: new Date()
  }).where(eq(Drafts.id, id));
}, { user: {}, apiKey: { scopes: [scopes.drafts.write] } });

// PATCH /api/drafts/{id}/file - Update file only
export const PATCHFile = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);

  const draft = await tx.query.Drafts.findFirst({
    where: eq(Drafts.id, id)
  });

  if (!draft) return routeResponse(404);
  await checkUserTeam(tx, authType, draft.team_id);

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return routeResponse(422, { message: "Missing file" });
  }

  await client.send(new PutObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${draft.team_id}/drafts/${id}`,
    ACL: "private",
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type
  }));

  await tx.update(Drafts).set({
    has_file: true,
    file_name: file.name,
    file_type: file.type,
    updated_at: new Date()
  }).where(eq(Drafts.id, id));
}, { user: {}, apiKey: { scopes: [scopes.drafts.write] } });

// DELETE /api/drafts/{id}
export const DELETE = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);

  const draft = await tx.query.Drafts.findFirst({
    where: eq(Drafts.id, id)
  });

  if (!draft) return routeResponse(404);
  await checkUserTeam(tx, authType, draft.team_id);

  await tx.delete(Drafts).where(eq(Drafts.id, id));

  if (draft.has_file) {
    await client.send(new DeleteObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      Key: `teams/${draft.team_id}/drafts/${id}`
    }));
  }
}, { user: {}, apiKey: { scopes: [scopes.drafts.write] } });

// POST /api/drafts/{id}/finalize
export const FINALIZE = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);

  const draft = await tx.query.Drafts.findFirst({
    where: eq(Drafts.id, id)
  });

  if (!draft) return routeResponse(404);
  await checkUserTeam(tx, authType, draft.team_id);

  // Validate required fields
  if (!draft.name || !draft.epic || !draft.ticket || !draft.quantity || !draft.has_file) {
    return routeResponse(422, { message: "Draft is incomplete. Required: name, epic, ticket, quantity, and file." });
  }

  let resultId: number;
  let resultType: "part" | "box_tube";

  if (draft.type === "part") {
    // Need either existing category or pending category
    let category_id = draft.category_id;

    if (!category_id && draft.pending_category) {
      // Create the category first
      const pc = draft.pending_category as { material: string; thickness: number };

      // Check if category already exists
      const existing = await tx.query.PartCategories.findFirst({
        where: (cat, { and, eq }) => and(
          eq(cat.team_id, draft.team_id),
          eq(cat.material, pc.material),
          eq(cat.thickness, pc.thickness)
        )
      });

      if (existing) {
        category_id = existing.id;
      } else {
        const [newCategory] = await tx.insert(PartCategories)
          .values({ material: pc.material, thickness: pc.thickness, team_id: draft.team_id })
          .returning({ id: PartCategories.id });
        category_id = newCategory.id;
      }
    }

    if (!category_id) {
      return routeResponse(422, { message: "Part requires a category" });
    }

    // Create the part
    const [part] = await tx.insert(Parts).values({
      name: draft.name,
      epic: draft.epic,
      ticket: draft.ticket,
      quantity: draft.quantity,
      original_quantity: draft.quantity,
      category_id
    }).returning({ id: Parts.id });

    // Copy S3 file from drafts/ to parts/
    const sourceKey = `teams/${draft.team_id}/drafts/${id}`;
    const destKey = `teams/${draft.team_id}/pc/${category_id}/parts/${part.id}`;

    await client.send(new CopyObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      CopySource: `${process.env.AUTOCAM_BUCKET}/${sourceKey}`,
      Key: destKey,
      ACL: "private"
    }));

    resultId = part.id;
    resultType = "part";
  } else {
    // Create box tube
    const [boxTube] = await tx.insert(BoxTubes).values({
      name: draft.name,
      epic: draft.epic,
      ticket: draft.ticket,
      quantity: draft.quantity,
      team_id: draft.team_id
    }).returning({ id: BoxTubes.id });

    // Copy S3 file
    const sourceKey = `teams/${draft.team_id}/drafts/${id}`;
    const destKey = `teams/${draft.team_id}/boxTubes/${boxTube.id}`;

    await client.send(new CopyObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      CopySource: `${process.env.AUTOCAM_BUCKET}/${sourceKey}`,
      Key: destKey,
      ACL: "private"
    }));

    resultId = boxTube.id;
    resultType = "box_tube";
  }

  // Delete the draft and its S3 file
  await tx.delete(Drafts).where(eq(Drafts.id, id));
  await client.send(new DeleteObjectCommand({
    Bucket: process.env.AUTOCAM_BUCKET,
    Key: `teams/${draft.team_id}/drafts/${id}`
  }));

  return routeResponse(200, { type: resultType, id: resultId });
}, { user: { emailVerified: true }, apiKey: { scopes: [scopes.drafts.write] } });
