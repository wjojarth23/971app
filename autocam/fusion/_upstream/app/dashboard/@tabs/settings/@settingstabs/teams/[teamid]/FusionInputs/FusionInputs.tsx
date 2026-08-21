"use client";

import { Material, Machine, Tool } from "@/app/types";
import styles from "./fusioninputs.module.css";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import FileUploadModal from "@/components/FileUploadModal/FileUploadModal";
import ToolLibraryEditorModal from "@/components/ToolLibraryEditor/ToolLibraryEditorModal";
import { useSearchParams } from "next/navigation";
import trpcClient from '@/lib/trpc/client';

function uniqueNumericIds(ids?: Array<number | string>): number[] {
  return Array.from(
    new Set(
      (ids ?? [])
        .map((id) => Number(id))
        .filter((numericId) => !Number.isNaN(numericId))
    )
  );
}

function uniqById<T extends { id: number | string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const normalized = Number(item.id);
    const key = Number.isNaN(normalized)
      ? `str:${item.id}`
      : `num:${normalized}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function Machines({ teamId }: { teamId: number }) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<
    Record<number, NodeJS.Timeout>
  >({});

  // Load machines from API
  useEffect(() => {
    if (!teamId) return;
    let mounted = true;
    setIsLoading(true);
    async function loadMachines() {
      try {
        const response = await fetch(`/api/teams/${teamId}/machines`);
        if (response.ok) {
          const data = (await response.json()) as Machine[];
          if (mounted) {
            setMachines(
              data.map((machine) => ({
                ...machine,
                can_run_box_tubes: Boolean(machine.can_run_box_tubes),
                can_run_plates:
                  machine.can_run_plates === undefined
                    ? true
                    : Boolean(machine.can_run_plates),
                box_tube_default_orientation:
                  machine.box_tube_default_orientation === "horizontal"
                    ? "horizontal"
                    : "vertical",
              }))
            );
          }
        }
      } catch (error) {
        console.error("Error loading machines:", error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    loadMachines();
    return () => {
      mounted = false;
    };
  }, [teamId]);

  // Cleanup pending timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(pendingUpdates).forEach(clearTimeout);
    };
  }, [pendingUpdates]);

  const handleAddMachine = async (name: string, file: File) => {
    if (!teamId) return;
    try {
      const formData = new FormData();
      formData.append("data", JSON.stringify({ name }));
      formData.append("file", file);

      const response = await fetch(`/api/teams/${teamId}/machines`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        const { id } = await response.json();
        setMachines((prev) => [
          ...prev,
          {
            id,
            name,
            file: file.name,
            can_run_box_tubes: false,
            can_run_plates: true,
            box_tube_default_orientation: "vertical",
          },
        ]);
      }
    } catch (error) {
      console.error("Error adding machine:", error);
    }
  };

  function updateMachineLocal(machineId: number, name: string) {
    setMachines((prev) =>
      prev.map((m) => (m.id === machineId ? { ...m, name } : m))
    );

    // Debounce the API call
    if (pendingUpdates[machineId]) {
      clearTimeout(pendingUpdates[machineId]);
    }

    const timeout = setTimeout(() => {
      updateMachineApi(machineId, { name });
      setPendingUpdates((prev) => {
        const next = { ...prev };
        delete next[machineId];
        return next;
      });
    }, 500);

    setPendingUpdates((prev) => ({ ...prev, [machineId]: timeout }));
  }

  async function updateMachineApi(
    machineId: number,
    body: Partial<
      Pick<
        Machine,
        | "name"
        | "can_run_box_tubes"
        | "can_run_plates"
        | "box_tube_default_orientation"
      >
    >
  ) {
    try {
      await fetch(`/api/machines/${machineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      console.error("Error updating machine:", error);
    }
  }

  function updateMachineFlag(
    machineId: number,
    key: "can_run_box_tubes" | "can_run_plates",
    value: boolean
  ) {
    setMachines((prev) =>
      prev.map((m) => (m.id === machineId ? { ...m, [key]: value } : m))
    );
    updateMachineApi(machineId, {
      [key]: value,
    } as Partial<
      Pick<
        Machine,
        | "name"
        | "can_run_box_tubes"
        | "can_run_plates"
        | "box_tube_default_orientation"
      >
    >);
  }

  function updateMachineOrientation(
    machineId: number,
    value: "vertical" | "horizontal"
  ) {
    setMachines((prev) =>
      prev.map((m) =>
        m.id === machineId
          ? { ...m, box_tube_default_orientation: value }
          : m
      )
    );
    updateMachineApi(machineId, { box_tube_default_orientation: value });
  }

  async function deleteMachine(machineId: number) {
    try {
      const response = await fetch(`/api/machines/${machineId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setMachines((prev) => prev.filter((m) => m.id !== machineId));
      }
    } catch (error) {
      console.error("Error deleting machine:", error);
    }
  }

  return (
    <main id={styles.machinesContainer}>
      <FileUploadModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddMachine}
        title="Add Machine"
        acceptedFileType=".cps"
        fileTypeLabel="CPS"
      />
      <div id={styles.addMachineContainer} onClick={() => setIsModalOpen(true)}>
        <Image
          src="/settings/teams/Plus.svg"
          width={2000}
          height={2000}
          alt="logo"
          className={styles.addIcon}
        />
      </div>
      {isLoading ? (
        <div className={styles.loadingContainer}>
          <span className={styles.loadingSpinner} />
        </div>
      ) : machines.length === 0 ? (
        <div className={styles.emptyState}>Add a machine to get started</div>
      ) : (
        machines.map((machine) => (
          <div key={machine.id} className={styles.machineContainer}>
            <input
              type="text"
              value={machine.name}
              placeholder="Name"
              id={styles.machineInput}
              onChange={(e) => updateMachineLocal(machine.id, e.target.value)}
            />
            <div className={styles.machineFlags}>
              <label className={styles.machineCheckbox}>
                <input
                  type="checkbox"
                  checked={
                    machine.can_run_plates === undefined
                      ? true
                      : Boolean(machine.can_run_plates)
                  }
                  onChange={(e) =>
                    updateMachineFlag(
                      machine.id,
                      "can_run_plates",
                      e.target.checked
                    )
                  }
                />
                <span>Plates</span>
              </label>
              <label className={styles.machineCheckbox}>
                <input
                  type="checkbox"
                  checked={Boolean(machine.can_run_box_tubes)}
                  onChange={(e) =>
                    updateMachineFlag(
                      machine.id,
                      "can_run_box_tubes",
                      e.target.checked
                    )
                  }
                />
                <span>Box tubes</span>
              </label>
              {machine.can_run_box_tubes && (
                <div className={styles.machineOrientation}>
                  <span className={styles.machineOrientationLabel}>
                    Tube default
                  </span>
                  <div className={styles.machineOrientationToggle}>
                    {(["vertical", "horizontal"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={`${styles.machineOrientationButton} ${
                          machine.box_tube_default_orientation === value
                            ? styles.machineOrientationButtonActive
                            : ""
                        }`}
                        onClick={() =>
                          updateMachineOrientation(machine.id, value)
                        }
                      >
                        {value === "vertical" ? "Vertical" : "Horizontal"}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Image
              alt="Trash"
              src="/settings/teams/trash.svg"
              width={2000}
              height={2000}
              onClick={() => deleteMachine(machine.id)}
              className={styles.trashIcon}
            />
          </div>
        ))
      )}
    </main>
  );
}

function Materials({ teamId }: { teamId: number }) {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [boxTubeMaterialId, setBoxTubeMaterialId] = useState<number | null>(
    null
  );
  const [isDefaultLoading, setIsDefaultLoading] = useState(true);
  const [pendingUpdates, setPendingUpdates] = useState<
    Record<number, NodeJS.Timeout>
  >({});

  // Load materials from API
  useEffect(() => {
    if (!teamId) return;
    let mounted = true;
    setIsLoading(true);
    async function loadMaterials() {
      try {
        const response = await fetch(`/api/teams/${teamId}/materials`);
        if (response.ok) {
          const data = await response.json();
          if (mounted) {
            setMaterials(data);
          }
        }
      } catch (error) {
        console.error("Error loading materials:", error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    loadMaterials();
    return () => {
      mounted = false;
    };
  }, [teamId]);

  useEffect(() => {
    if (!teamId) return;
    let mounted = true;
    setIsDefaultLoading(true);
    async function loadTeamDefaults() {
      try {
        const teams = (await trpcClient.teams.get.query());
        if (!mounted) return;
        const team = teams.find((t) => t.id === teamId);
        setBoxTubeMaterialId(team?.box_tube_material_id ?? null);
      } catch (error) {
        console.error("Error loading team defaults:", error);
      } finally {
        if (mounted) setIsDefaultLoading(false);
      }
    }
    loadTeamDefaults();
    return () => {
      mounted = false;
    };
  }, [teamId]);

  // Cleanup pending timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(pendingUpdates).forEach(clearTimeout);
    };
  }, [pendingUpdates]);

  async function addMaterial() {
    if (!teamId) return;
    try {
      const response = await fetch(`/api/teams/${teamId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }),
      });
      if (response.ok) {
        const { id } = await response.json();
        setMaterials((prev) => [...prev, { id, name: "" }]);
      }
    } catch (error) {
      console.error("Error adding material:", error);
    }
  }

  function updateMaterialLocal(materialId: number, name: string) {
    setMaterials((prev) =>
      prev.map((m) => (m.id === materialId ? { ...m, name } : m))
    );

    // Debounce the API call
    if (pendingUpdates[materialId]) {
      clearTimeout(pendingUpdates[materialId]);
    }

    const timeout = setTimeout(() => {
      updateMaterialApi(materialId, name);
      setPendingUpdates((prev) => {
        const next = { ...prev };
        delete next[materialId];
        return next;
      });
    }, 500);

    setPendingUpdates((prev) => ({ ...prev, [materialId]: timeout }));
  }

  async function updateMaterialApi(materialId: number, name: string) {
    try {
      await fetch(`/api/materials/${materialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    } catch (error) {
      console.error("Error updating material:", error);
    }
  }

  async function deleteMaterial(materialId: number) {
    try {
      const response = await fetch(`/api/materials/${materialId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setMaterials((prev) => prev.filter((m) => m.id !== materialId));
      }
    } catch (error) {
      console.error("Error deleting material:", error);
    }
  }

  async function updateBoxTubeMaterial(nextId: number | null) {
    if (!teamId) return;
    setBoxTubeMaterialId(nextId);
    try {
      const formData = new FormData();
      formData.append(
        "data",
        JSON.stringify({ box_tube_material_id: nextId })
      );
      const response = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        body: formData,
      });
      if (!response.ok) {
        console.error(
          "Failed to update box tube material:",
          await response.text()
        );
      }
    } catch (error) {
      console.error("Error updating box tube material:", error);
    }
  }

  return (
    <main id={styles.materialsContainer}>
      <div className={styles.boxTubeMaterialCard}>
        <div className={styles.boxTubeMaterialHeader}>
          <span className={styles.boxTubeMaterialTitle}>
            Box tube default material
          </span>
          <span className={styles.boxTubeMaterialSubtitle}>
            Used when opening the box tube CAM modal.
          </span>
        </div>
        <select
          className={styles.boxTubeMaterialSelect}
          value={boxTubeMaterialId ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            updateBoxTubeMaterial(value ? Number(value) : null);
          }}
          disabled={isDefaultLoading || materials.length === 0}
        >
          <option value="">Auto (first aluminum)</option>
          {materials.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name || "Untitled material"}
            </option>
          ))}
        </select>
      </div>
      <div id={styles.addMachineContainer} onClick={addMaterial}>
        <Image
          src="/settings/teams/Plus.svg"
          width={2000}
          height={2000}
          alt="logo"
          className={styles.addIcon}
        />
      </div>
      {isLoading ? (
        <div className={styles.loadingContainer}>
          <span className={styles.loadingSpinner} />
        </div>
      ) : materials.length === 0 ? (
        <div className={styles.emptyState}>Add a material to get started</div>
      ) : (
        materials.map((material) => (
          <div key={material.id} className={styles.machineContainer}>
            <input
              type="text"
              value={material.name}
              placeholder="Name"
              id={styles.materialInput}
              onChange={(e) => updateMaterialLocal(material.id, e.target.value)}
            />
            <Image
              alt="Trash"
              src="/settings/teams/trash.svg"
              width={2000}
              height={2000}
              onClick={() => deleteMaterial(material.id)}
              className={styles.trashIcon}
            />
          </div>
        ))
      )}
    </main>
  );
}

function ToolItem({
  tool,
  totalMaterials,
  totalMachines,
  onDeleteTool,
  onUpdateToolName,
  onToggleToolMaterial,
  onToggleToolMachine,
  onEditTool,
}: {
  tool: Tool;
  totalMaterials: Material[];
  totalMachines: Machine[];
  onDeleteTool: (toolId: number) => void;
  onUpdateToolName: (toolId: number, name: string) => void;
  onToggleToolMaterial: (toolId: number, material: Material) => void;
  onToggleToolMachine: (toolId: number, machine: Machine) => void;
  onEditTool: (toolId: number, toolName: string) => void;
}) {
  const [dropdownMaterialsEnabled, setDropdownMaterialsEnabled] =
    useState<boolean>(false);
  const [dropdownMachinesEnabled, setDropdownMachinesEnabled] =
    useState<boolean>(false);
  const materials = tool.materials;
  console.log("tool materials:", materials);
  const machines = tool.machines;
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownMaterialsRef.current &&
        !dropdownMaterialsRef.current.contains(e.target as Node)
      ) {
        if (dropdownMaterialsBlurRef.current) {
          dropdownMaterialsBlurRef.current.style.opacity = "0";
        }
        setDropdownMaterialsEnabled(false);
      } else if (
        dropdownMachinesRef.current &&
        !dropdownMachinesRef.current.contains(e.target as Node)
      ) {
        if (dropdownMachinesBlurRef.current) {
          dropdownMachinesBlurRef.current.style.opacity = "0";
        }
        setDropdownMachinesEnabled(false);
      }
    }

    if (dropdownMaterialsEnabled || dropdownMachinesEnabled) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownMaterialsEnabled, dropdownMachinesEnabled]);
  const dropdownMaterialsRef = useRef<HTMLDivElement>(null);
  const dropdownMaterialsBlurRef = useRef<HTMLSpanElement>(null);
  const dropdownMachinesRef = useRef<HTMLDivElement>(null);
  const dropdownMachinesBlurRef = useRef<HTMLSpanElement>(null);
  return (
    <div className={styles.toolsContainer}>
      <input
        type="text"
        value={tool.name}
        placeholder="Name"
        id={styles.toolInput}
        onChange={(e) => {
          onUpdateToolName(tool.id, e.target.value);
        }}
      />
      <div className={styles.materialDropdown}>
        <div className={styles.materialDropdownHeader}>
          <div className={styles.materialDropdownSelected}>
            {materials.slice(0, 2).map((material) => (
              <div key={material.id}>
                <div className={styles.specificName}>{material.name}</div>
              </div>
            ))}
            {materials.length > 2 && <span>...</span>}
          </div>
          <Image
            src="/settings/teams/Dropdown.svg"
            width={2000}
            height={2000}
            alt="logo"
            onClick={() => {
              setDropdownMaterialsEnabled((prev) => !prev);
            }}
            className={styles.dropdownIcon}
          />
          <AnimatePresence>
            {dropdownMaterialsEnabled && (
              <div ref={dropdownMaterialsRef}>
                <span
                  className={styles.dropdownBlur}
                  ref={dropdownMaterialsBlurRef}
                />
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={styles.materialDropdownList}
                >
                  {totalMaterials.map((material) => (
                    <div key={material.id} className={styles.dropdownItem}>
                      <label className={styles.checkbox}>
                        <input
                          type="checkbox"
                          checked={materials.some((m) => m.id === material.id)}
                          onChange={() => {
                            onToggleToolMaterial(tool.id, material);
                          }}
                        />
                        <span className={styles.checkboxBox}>
                          <Image
                            src="/settings/teams/X.svg"
                            width={2000}
                            height={2000}
                            alt="logo"
                            className={styles.checkboxIcon}
                          />
                        </span>
                      </label>
                      <span className={styles.specificName}>
                        {material.name}
                      </span>
                    </div>
                  ))}
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className={styles.machineDropdown}>
        <div className={styles.machineDropdownHeader}>
          <div className={styles.machineDropdownSelected}>
            {machines.slice(0, 2).map((machine) => (
              <div key={machine.id}>
                <div className={styles.specificName}>{machine.name}</div>
              </div>
            ))}
            {machines.length > 2 && <span>...</span>}
          </div>
          <Image
            src="/settings/teams/Dropdown.svg"
            width={2000}
            height={2000}
            alt="logo"
            onClick={() => {
              setDropdownMachinesEnabled((prev) => !prev);
            }}
            className={styles.dropdownIcon}
          />
          <AnimatePresence>
            {dropdownMachinesEnabled && (
              <div ref={dropdownMachinesRef}>
                <span
                  className={styles.dropdownBlur}
                  ref={dropdownMachinesBlurRef}
                />
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={styles.machineDropdownList}
                >
                  {totalMachines.map((machine) => (
                    <div key={machine.id} className={styles.dropdownItem}>
                      <label className={styles.checkbox}>
                        <input
                          type="checkbox"
                          checked={machines.some((m) => m.id === machine.id)}
                          onChange={() => {
                            onToggleToolMachine(tool.id, machine);
                          }}
                        />
                        <span className={styles.checkboxBox}>
                          <Image
                            src="/settings/teams/X.svg"
                            width={2000}
                            height={2000}
                            alt="logo"
                            className={styles.checkboxIcon}
                          />
                        </span>
                      </label>
                      <span className={styles.specificName}>
                        {machine.name}
                      </span>
                    </div>
                  ))}
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <div className={styles.fileName}>
        <span>{tool.file || "Uploaded"}</span>
      </div>
      <Image
        alt="Edit"
        src="/settings/teams/Edit.svg"
        width={2000}
        height={2000}
        onClick={() => onEditTool(tool.id, tool.name)}
        className={styles.editIcon}
      />
      <Image
        alt="Trash"
        src="/settings/teams/trash.svg"
        width={2000}
        height={2000}
        onClick={() => onDeleteTool(tool.id)}
        className={styles.trashIcon}
      />
    </div>
  );
}

function Tools({ teamId }: { teamId: number }) {
  const [tools, setTools] = useState<Tool[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingToolId, setEditingToolId] = useState<number | null>(null);
  const [editingToolName, setEditingToolName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [pendingUpdates, setPendingUpdates] = useState<
    Record<number, NodeJS.Timeout>
  >({});
  const [pendingAssignmentUpdates, setPendingAssignmentUpdates] = useState<
    Record<number, NodeJS.Timeout>
  >({});
  const [totalMaterials, setTotalMaterials] = useState<Material[]>([]);
  const [totalMachines, setTotalMachines] = useState<Machine[]>([]);
  const toolsRef = useRef<Tool[]>([]);

  useEffect(() => {
    toolsRef.current = tools;
  }, [tools]);

  // Load tools/materials/machines from API
  useEffect(() => {
    if (!teamId) return;
    let mounted = true;
    setIsLoading(true);

    async function loadAll() {
      try {
        const [toolsRes, materialsRes, machinesRes] = await Promise.all([
          fetch(`/api/teams/${teamId}/tools`),
          fetch(`/api/teams/${teamId}/materials`),
          fetch(`/api/teams/${teamId}/machines`),
        ]);

        if (!mounted) return;

        let materials: Material[] = [];
        let machines: Machine[] = [];

        if (materialsRes.ok) {
          materials = (await materialsRes.json()) as Material[];
        }

        if (machinesRes.ok) {
          const rawMachines = (await machinesRes.json()) as Partial<Machine>[];
          machines = rawMachines.map((m) => ({
            id: m.id as number,
            name: m.name as string,
            file: typeof m.file === "string" ? m.file : "",
          }));
        }

        setTotalMaterials(materials);
        setTotalMachines(machines);

        if (toolsRes.ok) {
          const tools = (await toolsRes.json()) as Array<{
            id: number;
            name: string;
            material_ids?: number[];
            machine_ids?: number[];
            default_selected?: boolean;
          }>;

          const materialsById = new Map(
            materials.map((m) => [m.id, m] as const)
          );
          const machinesById = new Map(machines.map((m) => [m.id, m] as const));

          setTools(
            tools.map((t) => {
              const materialIds = uniqueNumericIds(
                Array.from(new Set(t.material_ids ?? []))
              );
              const machineIds = uniqueNumericIds(
                Array.from(new Set(t.machine_ids ?? []))
              );
              return {
                id: t.id,
                name: t.name,
                materials: materialIds
                  .map((id) => materialsById.get(id))
                  .filter((m): m is Material => Boolean(m)),
                machines: machineIds
                  .map((id) => machinesById.get(id))
                  .filter((m): m is Machine => Boolean(m)),
                file: "",
                default_selected: Boolean(t.default_selected),
              };
            })
          );
        } else {
          setTools([]);
        }
      } catch (error) {
        console.error("Error loading tools:", error);
        if (!mounted) return;
        setTools([]);
        setTotalMaterials([]);
        setTotalMachines([]);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadAll();
    return () => {
      mounted = false;
    };
  }, [teamId]);

  // Cleanup pending timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(pendingUpdates).forEach(clearTimeout);
    };
  }, [pendingUpdates]);

  useEffect(() => {
    return () => {
      Object.values(pendingAssignmentUpdates).forEach(clearTimeout);
    };
  }, [pendingAssignmentUpdates]);

  const handleAddTool = async (name: string, file: File) => {
    if (!teamId) return;
    try {
      const formData = new FormData();
      formData.append("data", JSON.stringify({ name }));
      formData.append("file", file);

      const response = await fetch(`/api/teams/${teamId}/tools`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        console.error("Failed to add tool:", await response.text());
        return;
      }

      const { id } = (await response.json()) as { id: number };
      setTools((prev) => [
        ...prev,
        {
          id,
          name,
          materials: [],
          machines: [],
          file: file.name,
          default_selected: false,
        },
      ]);
    } catch (error) {
      console.error("Error adding tool:", error);
    }
  };

  function updateToolNameLocal(toolId: number, name: string) {
    setTools((prev) => prev.map((t) => (t.id === toolId ? { ...t, name } : t)));

    if (pendingUpdates[toolId]) {
      clearTimeout(pendingUpdates[toolId]);
    }

    const timeout = setTimeout(() => {
      updateToolNameApi(toolId, name);
      setPendingUpdates((prev) => {
        const next = { ...prev };
        delete next[toolId];
        return next;
      });
    }, 500);

    setPendingUpdates((prev) => ({ ...prev, [toolId]: timeout }));
  }

  async function updateToolNameApi(toolId: number, name: string) {
    const current = toolsRef.current.find((t) => t.id === toolId);
    const materialIds = current?.materials.map((m) => m.id) ?? [];
    const machineIds = current?.machines.map((m) => m.id) ?? [];
    try {
      const response = await fetch(`/api/tools/${toolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          material_ids: materialIds,
          machine_ids: machineIds,
        }),
      });
      if (!response.ok) {
        console.error("Failed to update tool:", await response.text());
      }
    } catch (error) {
      console.error("Error updating tool:", error);
    }
  }

  function scheduleAssignmentsUpdate(
    toolId: number,
    materialIds: number[],
    machineIds: number[]
  ) {
    if (pendingAssignmentUpdates[toolId]) {
      clearTimeout(pendingAssignmentUpdates[toolId]);
    }

    const timeout = setTimeout(() => {
      updateToolAssignmentsApi(toolId, materialIds, machineIds);
      setPendingAssignmentUpdates((prev) => {
        const next = { ...prev };
        delete next[toolId];
        return next;
      });
    }, 500);

    setPendingAssignmentUpdates((prev) => ({ ...prev, [toolId]: timeout }));
  }

  async function updateToolAssignmentsApi(
    toolId: number,
    materialIds: number[],
    machineIds: number[]
  ) {
    try {
      const response = await fetch(`/api/tools/${toolId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material_ids: materialIds,
          machine_ids: machineIds,
        }),
      });
      if (!response.ok) {
        console.error(
          "Failed to update tool assignments:",
          await response.text()
        );
      }
    } catch (error) {
      console.error("Error updating tool assignments:", error);
    }
  }

  function toggleToolMaterial(toolId: number, material: Material) {
    setTools((prev) =>
      prev.map((t) => {
        if (t.id !== toolId) return t;

        const normalizedMaterialId = Number(material.id);
        const exists = t.materials.some(
          (m) => Number(m.id) === normalizedMaterialId
        );
        const updatedMaterials = uniqById(
          exists
            ? t.materials.filter(
                (m) => Number(m.id) !== normalizedMaterialId
              )
            : [...t.materials, material]
        );

        scheduleAssignmentsUpdate(
          toolId,
          updatedMaterials
            .map((m) => Number(m.id))
            .filter((id) => !Number.isNaN(id)),
          uniqById(t.machines)
            .map((m) => Number(m.id))
            .filter((id) => !Number.isNaN(id))
        );

        return { ...t, materials: updatedMaterials };
      })
    );
  }

  function toggleToolMachine(toolId: number, machine: Machine) {
    setTools((prev) =>
      prev.map((t) => {
        if (t.id !== toolId) return t;

        const normalizedMachineId = Number(machine.id);
        const exists = t.machines.some(
          (m) => Number(m.id) === normalizedMachineId
        );
        const updatedMachines = uniqById(
          exists
            ? t.machines.filter(
                (m) => Number(m.id) !== normalizedMachineId
              )
            : [...t.machines, machine]
        );

        scheduleAssignmentsUpdate(
          toolId,
          uniqById(t.materials)
            .map((m) => Number(m.id))
            .filter((id) => !Number.isNaN(id)),
          updatedMachines
            .map((m) => Number(m.id))
            .filter((id) => !Number.isNaN(id))
        );

        return { ...t, machines: updatedMachines };
      })
    );
  }

  async function deleteTool(toolId: number) {
    try {
      const response = await fetch(`/api/tools/${toolId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setTools((prev) => prev.filter((t) => t.id !== toolId));
      } else {
        console.error("Failed to delete tool:", await response.text());
      }
    } catch (error) {
      console.error("Error deleting tool:", error);
    }
  }

  function openToolEditor(toolId: number, toolName: string) {
    setEditingToolId(toolId);
    setEditingToolName(toolName);
    setIsEditorOpen(true);
  }

  function closeToolEditor() {
    setIsEditorOpen(false);
    setEditingToolId(null);
    setEditingToolName("");
  }

  return (
    <main id={styles.toolsContainer}>
      <FileUploadModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddTool}
        title="Add Tool"
        acceptedFileType=".json"
        fileTypeLabel="JSON"
      />
      {editingToolId !== null && (
        <ToolLibraryEditorModal
          isOpen={isEditorOpen}
          onClose={closeToolEditor}
          toolId={editingToolId}
          toolName={editingToolName}
        />
      )}
      <div id={styles.addMachineContainer} onClick={() => setIsModalOpen(true)}>
        <Image
          src="/settings/teams/Plus.svg"
          width={2000}
          height={2000}
          alt="logo"
          className={styles.addIcon}
        />
      </div>
      {isLoading ? (
        <div className={styles.loadingContainer}>
          <span className={styles.loadingSpinner} />
        </div>
      ) : tools.length === 0 ? (
        <div className={styles.emptyState}>Add a tool to get started</div>
      ) : (
        tools.map((tool) => (
          <ToolItem
            key={tool.id}
            tool={tool}
            totalMaterials={totalMaterials}
            totalMachines={totalMachines}
            onDeleteTool={deleteTool}
            onUpdateToolName={updateToolNameLocal}
            onToggleToolMaterial={toggleToolMaterial}
            onToggleToolMachine={toggleToolMachine}
            onEditTool={openToolEditor}
          />
        ))
      )}
    </main>
  );
}

export default function FusionInputs({ teamId }: { teamId: number }) {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab")?.toLowerCase();
  const initialTab =
    tabParam === "materials"
      ? "Materials"
      : tabParam === "tools"
      ? "Tools"
      : "Machines";

  const [selectedTab, setSelectedTab] = useState<string>(initialTab);

  useEffect(() => {
    setSelectedTab(initialTab);
  }, [initialTab]);
  return (
    <form>
      <label className={styles.sectionLabel}>Machines, Tools & Materials</label>
      <div id={styles.container}>
        <div id={styles.sidebar}>
          <div
            onClick={() => setSelectedTab("Machines")}
            className={selectedTab === "Machines" ? styles.active : ""}
          >
            <img
              src="/settings/teams/machines.png"
              width={2000}
              height={2000}
              alt="logo"
              className={styles.sidebarLogo}
            />
            <span>Machines</span>
          </div>
          <div
            onClick={() => setSelectedTab("Materials")}
            className={selectedTab === "Materials" ? styles.active : ""}
          >
            <Image
              src="/settings/teams/materials.svg"
              width={2000}
              height={2000}
              alt="logo"
              className={styles.sidebarLogo}
            />
            <span>Materials</span>
          </div>
          <div
            onClick={() => setSelectedTab("Tools")}
            className={selectedTab === "Tools" ? styles.active : ""}
          >
            <Image
              src="/settings/teams/tools.svg"
              width={2000}
              height={2000}
              alt="logo"
              className={styles.sidebarLogo}
            />
            <span>Tools</span>
          </div>
        </div>
        <div id={styles.inputsContainer}>
          {selectedTab === "Machines" && <Machines teamId={teamId} />}
          {selectedTab === "Materials" && <Materials teamId={teamId} />}
          {selectedTab === "Tools" && <Tools teamId={teamId} />}
        </div>
        <span id={styles.verticalrule} />
      </div>
    </form>
  );
}
