import "./invites";
import "./members";

import { TeamKeys, TeamMembers } from "@/lib/db/schema/entities";
import { Teams } from "@/lib/db/schema/core";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import zod from "zod";
import { registry } from "@/lib/openapi/registry";
import { apiKey, userSession } from "../auth";
import { scopeNames, scopeNames as scopes } from "../../scopes";
import { checkUserTeam, CommonAuthorization, Conflict, NotFound, parseSchema, routeFactory, routeResponse, s3DeleteWithPrefix, ValidationError, parseFormData } from "../common";
import { eq } from "drizzle-orm";
import { user } from "@/lib/db/schema/auth";
import { client } from "@/lib/aws";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { procedure, router } from "../../trpc/server";
import db from "@/lib/db";
import { TRPCError } from "@trpc/server";
import keys from "./keys";

const UpdateSchema = zod.object({
  data: createUpdateSchema(Teams).extend({
    owner: zod.email().optional()
  }).omit({ logo: true }),
  logo: zod.instanceof(File).optional().openapi({ type: "string", format: "binary" })
});

registry.registerPath({
  method: "patch",
  path: "/api/teams/{id}",
  tags: ["Teams"],
  summary: "Update Team",
  description: "This endpoint requires the user's email to be verified",
  request: {
    params: zod.object({ id: zod.number().openapi({ description: "ID of the team that is being updated" }) }),
    body: {
      description: "If the logo is a URL, use the application/json. If the logo is a file upload, use the multipart/form-data type.",
      content: {
        "multipart/form-data": {
          schema: zod.object({
            data: UpdateSchema,
            logo: zod.instanceof(File).openapi({ type: "string", format: "binary", description: "Logo upload" })
          })
        }
      }
    }
  },
  responses: {
    204: {
      description: "Team updated successfully",
    },
    ...CommonAuthorization,
    ...ValidationError,
    ...NotFound
  }
});

export const PATCH = routeFactory(async (req, authType, tx, id) => {
  if (!id) return routeResponse(422);
  await checkUserTeam(tx, authType, id, true);
  const schema = UpdateSchema.extend({
    data: UpdateSchema.shape.data.extend({
      owner: zod.email().optional().transform(async owner => {
        if (!owner) return;
        const newOwner = await tx.query.user.findFirst({ where: eq(user.email, owner) });
        if (!newOwner) throw routeResponse(404);
        return newOwner.id;
      })
    })
  });
  const { data, logo } = await parseFormData(await req.formData(), schema);
  if (!data) return routeResponse(422);
  let logoLink: string | undefined;
  if (logo)
    logoLink = `https://${process.env.AUTOCAM_BUCKET}.s3.amazonaws.com/teams/${id}/logo`
  await tx.update(Teams).set({ ...data, logo: logoLink }).where(eq(Teams.id, id));
  if (logo) {
    await client.send(new PutObjectCommand({
      Bucket: process.env.AUTOCAM_BUCKET,
      Key: `teams/${id}/logo`,
      Body: await logo.bytes(),
      ACL: "public-read",
      ContentType: logo.type
    }));
  }
  return routeResponse(204);
}, { user: { emailVerified: true } });

export default router({
  get: procedure.meta({
    openapi: { method: "GET", path: "/api/trpc/teams.get" },
    authStrategies: ["user", "apiKey"],
    scopes: [scopeNames.teams.read]
  }).output(zod.array(createSelectSchema(Teams).extend({
    owner: zod.object({
      email: zod.email()
    }).transform(x => x.email).pipe(zod.email())
  }))).query(async opts => {
    if (opts.ctx.session) {
      return (await db.query.TeamMembers.findMany({
        where: eq(TeamMembers.user_id, opts.ctx.session.user.id),
        with: { team: { with: { owner: true } } }
      })).map(x => x.team);
    }
    const key = await db.query.TeamKeys.findFirst({
      where: eq(TeamKeys.digest, opts.ctx.apiKey!),
      with: { team: { with: { owner: true } } }
    });
    return [key!.team];
  }),

  create: procedure.meta({
    openapi: { method: "POST", path: "/api/trpc/teams.create" },
    authStrategies: ["user"],
    emailVerified: true
  }).input(createInsertSchema(Teams).omit({ owner: true, logo: true }))
    .output(zod.number())
    .mutation(async opts => {
      const [id] = await db.insert(Teams).values({
        ...opts.input,
        owner: opts.ctx.session!.user.id
      }).returning({ id: Teams.id });
      await db.insert(TeamMembers).values({
        user_id: opts.ctx.session!.user.id,
        team_id: id.id,
        admin: true
      });
      return id.id;
    }),

  delete: procedure.meta({
    openapi: { method: "POST", path: "/api/trpc/teams.delete" },
    authStrategies: ["user"],
    emailVerified: true
  }).input(zod.number()).mutation(async opts => {
    const team = await db.query.Teams.findFirst({
      where: eq(Teams.id, opts.input),
      columns: { owner: true }
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND" });
    if (team.owner !== opts.ctx.session!.user.id) throw new TRPCError({ code: "FORBIDDEN" });
    await db.delete(Teams).where(eq(Teams.id, opts.input));
    await s3DeleteWithPrefix(`teams/${opts.input}/`);
  }),

  keys
});
