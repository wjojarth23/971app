import { boolean, char, integer, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { relations } from "drizzle-orm";
import { Teams } from "./core";

export const TeamInvites = pgTable("team_invites", {
  id: uuid().primaryKey().defaultRandom(),
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
  email: text().notNull().references(() => user.email, { onDelete: "cascade" }),
  admin: boolean().notNull()
}, table => [
  unique().on(table.team_id, table.email),
]);

export const TeamMembers = pgTable("team_members", {
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
  // Needs to match what's in auth-schema.ts
  user_id: text().notNull().references(() => user.id, { onDelete: "cascade" }),
  admin: boolean().notNull().default(false),
}, table => [
  primaryKey({ columns: [table.team_id, table.user_id] })
]);

export const TeamKeys = pgTable("team_keys", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
  digest: char({ length: 64 }).notNull().unique(),
  name: text().notNull(),
  scopes: text().array().notNull(),
  is_fusion_server: boolean().notNull().default(false),
  last_activity: timestamp()
}, table => [
  unique().on(table.team_id, table.name),
]);

export const TeamRunners = pgTable("team_runners", {
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
  digest: char({ length: 64 }).notNull(),
  name: text().notNull(),
}, table => [
  primaryKey({ columns: [table.team_id, table.name] })
]);

export const TeamMembersRelations = relations(TeamMembers, ({ one }) => ({
  team: one(Teams, {
    fields: [TeamMembers.team_id],
    references: [Teams.id],
  }),
  user: one(user, {
    fields: [TeamMembers.user_id],
    references: [user.id],
  })
}));

export const TeamInvitesRelations = relations(TeamInvites, ({ one }) => ({
  team: one(Teams, {
    fields: [TeamInvites.team_id],
    references: [Teams.id],
  }),
}));

export const TeamKeysRelations = relations(TeamKeys, ({ one }) => ({
  team: one(Teams, {
    fields: [TeamKeys.team_id],
    references: [Teams.id]
  })
}));

export const TeamRunnersRelations = relations(TeamRunners, ({ one }) => ({
  team: one(Teams, {
    fields: [TeamRunners.team_id],
    references: [Teams.id]
  })
}));
