import { and, isNotNull, isNull, relations, type BuildQueryResult, type DBQueryConfig, type ExtractTablesWithRelations } from "drizzle-orm";
import { boolean, doublePrecision, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, type PgTableWithColumns } from "drizzle-orm/pg-core";
import { TeamKeys } from "./entities";
import { Materials, Teams } from "./core";
import { user } from "./auth";

export const PartCategories = pgTable("part_categories", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  material: text().notNull(),
  thickness: doublePrecision().notNull(),
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
}, table => [
  unique().on(table.team_id, table.material, table.thickness),
]);

export const Parts = pgTable("parts", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  epic: text().notNull(),
  ticket: text().notNull(),
  quantity: integer().notNull(),
  original_quantity: integer().notNull(),
  category_id: integer().notNull().references(() => PartCategories.id, { onDelete: "cascade" })
});

export const Plates = pgTable("plates", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  width: doublePrecision().notNull(),
  length: doublePrecision().notNull(),
  true_depth: doublePrecision().notNull(),
  category_id: integer().notNull().references(() => PartCategories.id, { onDelete: "cascade" }),
});

export const BoxTubes = pgTable("box_tubes", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  ticket: text().notNull(),
  epic: text().notNull(),
  quantity: integer().default(1).notNull(),
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" })
});

export const Machines = pgTable("machines", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
  can_run_box_tubes: boolean().notNull().default(false),
  can_run_plates: boolean().notNull().default(true),
  box_tube_default_orientation: text().notNull().default("vertical"),
}, table => [
  unique().on(table.name, table.team_id),
]);

export const Tools = pgTable("tools", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
  default_selected: boolean().notNull().default(false),
}, table => [
  unique().on(table.name, table.team_id),
]);

export const ToolMaterials = pgTable("tool_materials", {
  tool_id: integer().notNull().references(() => Tools.id, { onDelete: "cascade" }),
  material_id: integer().notNull().references(() => Materials.id, { onDelete: "cascade" }),
});

export const ToolMachines = pgTable("tool_machines", {
  tool_id: integer().notNull().references(() => Tools.id, { onDelete: "cascade" }),
  machine_id: integer().notNull().references(() => Machines.id, { onDelete: "cascade" })
})

export const PartCategoryAssignments = pgTable("parts_to_plates", {
  category_id: integer().notNull().references(() => PartCategories.id, { onDelete: "cascade" }),
  plate_id: integer().notNull().references(() => Plates.id, { onDelete: "cascade" }),
  part_id: integer().notNull().references(() => Parts.id, { onDelete: "cascade" }),
  quantity: integer().notNull()
}, table => [
  unique().on(table.plate_id, table.part_id),
]);

export const JobKind = pgEnum('job_kind', ["plate:arrange", "plate:cam", "box_tube"])

export const Jobs = pgTable("jobs", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
  kind: JobKind().notNull(),
  created_at: timestamp().notNull().defaultNow(),
  claimed_by: text().references(() => TeamKeys.digest),
  payload: jsonb().notNull(),
  response: jsonb()
}, table => [
  // Make sure that a single runner can't pick up more than one job at a time
  uniqueIndex("claimed_by_index").on(table.claimed_by).where(and(
    isNotNull(table.claimed_by),
    isNull(table.response)
  )!),
]);

export const PlateJobs = pgTable("plate_jobs", {
  job_id: integer().notNull().primaryKey().references(() => Jobs.id, { onDelete: "cascade" }),
  // No ON DELETE CASCADE here because we need the backend to explicitly delete the jobs entries to avoid orphaning jobs
  plate_id: integer().notNull().references(() => Plates.id),
});

export const BoxTubeJobs = pgTable("box_tube_jobs", {
  job_id: integer().notNull().primaryKey().references(() => Jobs.id, { onDelete: "cascade" }),
  // No ON DELETE CASCADE here because we need the backend to explicitly delete the jobs entries to avoid orphaning jobs
  box_tube_id: integer().notNull().references(() => BoxTubes.id, { onDelete: "cascade" }),
});

export const DraftType = pgEnum('draft_type', ["part", "box_tube"]);

export const Drafts = pgTable("drafts", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  team_id: integer().notNull().references(() => Teams.id, { onDelete: "cascade" }),
  user_id: text().notNull().references(() => user.id, { onDelete: "cascade" }),
  type: DraftType().notNull(),
  // Common fields (nullable since draft may be incomplete)
  name: text(),
  epic: text(),
  ticket: text(),
  quantity: integer(),
  // Part-specific fields
  category_id: integer().references(() => PartCategories.id, { onDelete: "set null" }),
  pending_category: jsonb(), // { material: string, thickness: number }
  // File info
  has_file: boolean().notNull().default(false),
  file_name: text(),
  file_type: text(),
  // Metadata
  created_at: timestamp().notNull().defaultNow(),
  updated_at: timestamp().notNull().defaultNow(),
});

export const PartsRelations = relations(Parts, ({ one }) => ({
  category: one(PartCategories, {
    fields: [Parts.category_id],
    references: [PartCategories.id]
  })
}));

export const PlatesRelations = relations(Plates, ({ one, many }) => ({
  category: one(PartCategories, {
    fields: [Plates.category_id],
    references: [PartCategories.id]
  }),
  assignments: many(PartCategoryAssignments),
  jobs: many(PlateJobs)
}));

export const PlateJobsRelations = relations(PlateJobs, ({ one }) => ({
  job: one(Jobs, {
    fields: [PlateJobs.job_id],
    references: [Jobs.id]
  }),
  plate: one(Plates, {
    fields: [PlateJobs.plate_id],
    references: [Plates.id]
  })
}));

export const BoxTubeJobsRelations = relations(BoxTubeJobs, ({ one }) => ({
  job: one(Jobs, {
    fields: [BoxTubeJobs.job_id],
    references: [Jobs.id]
  }),
  box_tube: one(BoxTubes, {
    fields: [BoxTubeJobs.box_tube_id],
    references: [BoxTubes.id]
  })
}));

export const PartCategoriesRelations = relations(PartCategories, ({ many, one }) => ({
  parts: many(Parts),
  plates: many(Plates),
  assignments: many(PartCategoryAssignments),
  team: one(Teams, {
    fields: [PartCategories.team_id],
    references: [Teams.id]
  })
}));

export const PartCategoryAssignmentsRelations = relations(PartCategoryAssignments, ({ one }) => ({
  part: one(Parts, {
    fields: [PartCategoryAssignments.part_id],
    references: [Parts.id]
  }),
  plate: one(Plates, {
    fields: [PartCategoryAssignments.plate_id],
    references: [Plates.id]
  }),
  category: one(PartCategories, {
    fields: [PartCategoryAssignments.category_id],
    references: [PartCategories.id]
  })
}));

export const BoxTubesRelations = relations(BoxTubes, ({ one, many }) => ({
  jobs: many(BoxTubeJobs),
  team: one(Teams, {
    fields: [BoxTubes.team_id],
    references: [Teams.id]
  })
}));

export const MaterialsRelations = relations(Materials, ({ one, many }) => ({
  team: one(Teams, {
    fields: [Materials.team_id],
    references: [Teams.id]
  }),
  toolMaterials: many(ToolMaterials)
}));

export const MachinesRelations = relations(Machines, ({ one, many }) => ({
  team: one(Teams, {
    fields: [Machines.team_id],
    references: [Teams.id]
  }),
  toolMachines: many(ToolMachines)
}));

export const ToolsRelations = relations(Tools, ({ one, many }) => ({
  team: one(Teams, {
    fields: [Tools.team_id],
    references: [Teams.id]
  }),
  machines: many(ToolMachines),
  materials: many(ToolMaterials)
}))

export const ToolMachinesRelations = relations(ToolMachines, ({ one }) => ({
  tool: one(Tools, {
    fields: [ToolMachines.tool_id],
    references: [Tools.id]
  }),
  machine: one(Machines, {
    fields: [ToolMachines.machine_id],
    references: [Machines.id]
  })
}))

export const ToolMaterialsRelations = relations(ToolMaterials, ({ one }) => ({
  tool: one(Tools, {
    fields: [ToolMaterials.tool_id],
    references: [Tools.id]
  }),
  material: one(Materials, {
    fields: [ToolMaterials.material_id],
    references: [Materials.id]
  })
}))

export const DraftsRelations = relations(Drafts, ({ one }) => ({
  team: one(Teams, {
    fields: [Drafts.team_id],
    references: [Teams.id]
  }),
  user: one(user, {
    fields: [Drafts.user_id],
    references: [user.id]
  }),
  category: one(PartCategories, {
    fields: [Drafts.category_id],
    references: [PartCategories.id]
  })
}))
