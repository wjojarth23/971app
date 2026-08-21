// Tool Library Editor Types
// Based on Fusion 360 tool library JSON format

export interface ToolGeometry {
  DC?: number;                    // Diameter (cutting)
  OAL?: number;                   // Overall length
  LB?: number;                    // Body length
  LCF?: number;                   // Flute/cutting length
  NOF?: number;                   // Number of flutes
  SFDM?: number;                  // Shaft/flute diameter
  HAND?: boolean;                 // Right-handed
  CSP?: boolean;                  // Coolant supply port
  SIG?: number;                   // Taper/tip angle
  TP?: number;                    // Thread pitch
  RE?: number;                    // Radius of edge (corner radius)
  NT?: number;                    // Number of teeth
  assemblyGaugeLength?: number;
  "shoulder-length"?: number;
  "shoulder-diameter"?: number;
  "thread-profile-angle"?: number;
  "tip-diameter"?: number;
  "tip-length"?: number;
  "tip-offset"?: number;
}

export interface PostProcessSettings {
  number?: number;                // Tool number in turret
  turret?: number;                // Turret position
  "diameter-offset"?: number;     // Diameter offset register
  "length-offset"?: number;       // Length offset register
  "manual-tool-change"?: boolean;
  "break-control"?: boolean;      // Chip breaking control
  live?: boolean;                 // Live tool indicator
  comment?: string;               // NC comment
}

export interface PresetMaterial {
  category?: string;
  query?: string;
  "use-hardness"?: boolean;
}

export interface Preset {
  guid?: string;
  name: string;
  description?: string;
  "tool-coolant"?: string;
  "use-feed-per-revolution"?: boolean;
  // Numeric parameters
  n?: number;                     // Spindle RPM
  n_ramp?: number;                // Ramp spindle RPM
  v_f?: number;                   // Feed rate
  v_f_plunge?: number;            // Plunge feed rate
  v_f_ramp?: number;              // Ramp feed rate
  v_f_retract?: number;           // Retract feed rate
  v_f_leadIn?: number;            // Entry feed rate
  v_f_leadOut?: number;           // Exit feed rate
  v_f_transition?: number;        // Transition feed rate
  f_z?: number;                   // Feed per tooth
  f_n?: number;                   // Feed per revolution
  stepdown?: number;              // Max depth of cut
  stepover?: number;              // Max width of cut
  "use-stepdown"?: boolean;
  "use-stepover"?: boolean;
  "ramp-angle"?: number;          // Ramp angle in degrees
  material?: PresetMaterial;
  // Expression-based parameters (for display)
  expressions?: Record<string, string>;
}

export interface ToolItem {
  // Basic info
  BMC?: string;                   // Base Material Code
  GRADE?: string;                 // Tool grade/type
  description: string;
  type: string;
  unit: "inches" | "millimeters";
  default_selected?: boolean;
  vendor?: string;
  "product-id"?: string;
  "product-link"?: string;
  guid: string;
  reference_guid?: string;
  last_modified?: number;
  // Nested objects
  geometry?: ToolGeometry;
  "post-process"?: PostProcessSettings;
  "start-values"?: {
    presets?: Preset[];
  };
  expressions?: Record<string, string>;
}

export interface ToolLibrary {
  data: ToolItem[];
  version: number;
}

// Tool types commonly used in Fusion 360
export const TOOL_TYPES = [
  "flat end mill",
  "ball end mill",
  "bull nose end mill",
  "chamfer mill",
  "face mill",
  "slot mill",
  "radius mill",
  "dovetail mill",
  "lollipop mill",
  "tapered mill",
  "drill",
  "center drill",
  "spot drill",
  "countersink",
  "counterbore",
  "tap right hand",
  "tap left hand",
  "reamer",
  "boring bar",
  "thread mill",
  "form mill",
  "engrave",
  "probe",
] as const;

export type ToolType = (typeof TOOL_TYPES)[number];

// Coolant options
export const COOLANT_OPTIONS = [
  "disabled",
  "flood",
  "mist",
  "through-tool",
  "air",
  "suction",
  "flood-mist",
  "flood-through-tool",
] as const;

export type CoolantOption = (typeof COOLANT_OPTIONS)[number];

// Helper to create a new empty tool
export function createEmptyTool(): ToolItem {
  return {
    description: "",
    type: "flat end mill",
    unit: "inches",
    default_selected: false,
    guid: crypto.randomUUID(),
    last_modified: Date.now(),
    geometry: {
      DC: 0.25,
      OAL: 2,
      LB: 1,
      LCF: 0.75,
      NOF: 4,
    },
    "post-process": {
      number: 1,
      "diameter-offset": 1,
      "length-offset": 1,
    },
    "start-values": {
      presets: [
        {
          guid: crypto.randomUUID(),
          name: "Default preset",
          "tool-coolant": "flood",
          n: 10000,
          v_f: 50,
          v_f_plunge: 25,
          stepdown: 0.1,
          stepover: 0.125,
        },
      ],
    },
  };
}

// Helper to create a new empty preset
export function createEmptyPreset(): Preset {
  return {
    guid: crypto.randomUUID(),
    name: "New preset",
    "tool-coolant": "flood",
    n: 10000,
    v_f: 50,
    v_f_plunge: 25,
    stepdown: 0.1,
    stepover: 0.125,
  };
}
