import { relations } from "drizzle-orm";
import { user } from "./auth";
import { BoxTubes, Machines, PartCategories, Tools } from "./cam";
import { Materials, Teams } from "./core";
import { TeamInvites, TeamKeys, TeamMembers, TeamRunners } from "./entities";

export const TeamsRelationse = relations(Teams, ({ many, one }) => ({
  teamMembers: many(TeamMembers),
  teamInvites: many(TeamInvites),
  runners: many(TeamRunners),
  partCategories: many(PartCategories),
  boxTubes: many(BoxTubes),
  keys: many(TeamKeys),
  materials: many(Materials),
  machines: many(Machines),
  tools: many(Tools),
  owner: one(user, {
    fields: [Teams.owner],
    references: [user.id],
  }),
}));
