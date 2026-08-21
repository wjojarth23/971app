import {
  PartCategories,
  Parts,
  PartCategoryAssignments,
  Plates,
  BoxTubes,
  Drafts,
} from "@/lib/db/schema/cam";
import { Teams } from "@/lib/db/schema/core";
import { InferSelectModel, InferInsertModel } from "drizzle-orm";



export type PartCategory = Omit<
  InferSelectModel<typeof PartCategories>,
  "thickness"
> & {
  thickness: number;
  plates?: Plate[];
  parts?: Part[];
};
export type Part = InferSelectModel<typeof Parts> & { category?: PartCategory };
export type Plate = InferSelectModel<typeof Plates> & {
  category?: PartCategory;
};
export type PartToPlate = InferSelectModel<typeof PartCategoryAssignments> & {
  plate?: Plate;
  part?: Part;
};
export type BoxTube = InferInsertModel<typeof BoxTubes> & {
  id: number;
  status?: "pending" | "in progress" | "completed";
};

export type Team = InferSelectModel<typeof Teams>;

export interface Assignment {
  plateId: string;
  parts: { id: string; quantity: number }[];
}

export interface Session {
  material: string;
  thickness: number;
  assignments: Assignment[];
  plates: Plate[];
  updatedAt: string;
  updatedBy: string;
}

export interface Material {
  id: number;
  name: string;
}

export interface Machine {
  id: number;
  name: string;
  file: string;
  can_run_box_tubes?: boolean;
  can_run_plates?: boolean;
  box_tube_default_orientation?: "vertical" | "horizontal";
}

export interface Tool {
  id: number,
  name: string;
  materials: Material[];
  machines: Machine[];
  file: string;
  default_selected: boolean;
}

export interface Collaborator {
  id: number;
  name: string;
  role: "Owner" | "Admin" | "Member" | "pending";
  email: string;
}

export interface ApiKey {
  id: number;
  name: string;
  scopes: string[];
  is_fusion_server: boolean;
  last_activity: string | null;
}

export interface TeamInvite {
  id: string;
  teamName: string;
}

export type PlatesJobStatus = "pending" | "in progress" | "completed";

export type PlatesJobKind = "arrange" | "cam";

export interface PlatesJob {
  id: number;
  kind: PlatesJobKind;
  status: PlatesJobStatus;
  queue_position: number;
  payload?: unknown;
  response?: unknown;
}

export type DraftType = "part" | "box_tube";

export interface PendingCategory {
  material: string;
  thickness: number;
}

export type Draft = Omit<InferSelectModel<typeof Drafts>, "pending_category"> & {
  pending_category: PendingCategory | null;
  file?: string;
  category?: PartCategory;
};
