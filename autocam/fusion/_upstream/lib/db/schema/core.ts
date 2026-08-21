import { integer, pgTable, text, unique } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const Teams = pgTable("teams", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  owner: text().notNull().references(() => user.id),
  logo: text(),
  box_tube_material_id: integer(),
});

export const Materials = pgTable(
  "materials",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    name: text().notNull(),
    team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
  },
  (table) => [unique().on(table.name, table.team_id)]
);
