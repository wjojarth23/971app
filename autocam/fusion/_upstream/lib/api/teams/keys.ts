import { TeamKeys } from "@/lib/db/schema/entities";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-zod";
import zod from "zod";
import { checkUserTeamTRPC } from "../common";
import { ScopeEnum } from "@/lib/scopes";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { procedure, router } from "@/lib/trpc/server";
import db from "@/lib/db";
import { TRPCError } from "@trpc/server";
import { createKeyDigest } from "@/lib/auth/keyDigest";

export default router({
  get: procedure.meta({
    openapi: { method: "GET", path: "/api/trpc/teams.keys.get" },
    authStrategies: ["user"]
  }).input(zod.number()).output(zod.array(createSelectSchema(TeamKeys).omit({ team_id: true, digest: true })))
    .query(async opts => {
      await checkUserTeamTRPC(opts.ctx, opts.input);
      return await db.query.TeamKeys.findMany({ where: eq(TeamKeys.team_id, opts.input) });
    }),

  create: procedure.meta({
    openapi: { method: "POST", path: "/api/trpc/teams.keys.create" },
    authStrategies: ["user"],
    emailVerified: true
  }).input(createInsertSchema(TeamKeys).extend({
    scopes: zod.array(ScopeEnum),
    is_fusion_server: zod.boolean().optional()
  }).omit({ digest: true })).output(zod.string())
    .mutation(async opts => {
      await checkUserTeamTRPC(opts.ctx, opts.input.team_id, true);
      const token = crypto.randomBytes(32).toString("hex");
      await db.insert(TeamKeys).values({
        ...opts.input,
        digest: createKeyDigest(token)
      });
      return token
    }),

  update: procedure.meta({
    openapi: { method: "POST", path: "/api/trpc/teams.keys.update" },
    authStrategies: ["user"],
    emailVerified: true
  }).input(createUpdateSchema(TeamKeys).extend({
    team_id: zod.number(),
    scopes: zod.array(ScopeEnum).optional(),
    is_fusion_server: zod.boolean().optional()
  }).omit({ digest: true }))
    .mutation(async opts => {
      const key = await db.query.TeamKeys.findFirst({ where: eq(TeamKeys.id, opts.input.team_id) });
      if (!key) throw new TRPCError({ code: "NOT_FOUND" });
      await checkUserTeamTRPC(opts.ctx, key.team_id, true);
      await db.update(TeamKeys).set(opts.input).where(eq(TeamKeys.id, opts.input.team_id));
    }),

  delete: procedure.meta({
    openapi: { method: "POST", path: "/api/trpc/teams.keys.delete" },
    authStrategies: ["user"],
    emailVerified: true
  }).input(zod.number()).mutation(async opts => {
    const key = await db.query.TeamKeys.findFirst({ where: eq(TeamKeys.id, opts.input) });
    if (!key) throw new TRPCError({ code: "NOT_FOUND" });
    await checkUserTeamTRPC(opts.ctx, key.team_id, true);
    await db.delete(TeamKeys).where(eq(TeamKeys.id, opts.input));
  })
});
