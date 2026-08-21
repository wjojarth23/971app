'use client';

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./boxtubes.module.css";
import type { Material } from "@/app/types";

type ToolItem = {
  id: string;
  name: string;
  libraryId: number;
  libraryName: string;
};

type BoxTubeCamModalProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  machines: Array<{
    id: number;
    name: string;
    box_tube_default_orientation?: "horizontal" | "vertical";
  }>;
  selectedMachineId: number | null;
  onSelectMachine: (machineId: number) => void;
  availableTools: ToolItem[];
  selectedToolIds: string[];
  onToggleTool: (toolId: string) => void;
  onToggleToolLibrary: (toolIds: string[]) => void;
  orientation: string;
  onSelectOrientation: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  materials: Material[];
  materialOverride: boolean;
  selectedMaterialId: number | null;
  onToggleMaterialOverride: () => void;
  onSelectMaterial: (materialId: number) => void;
  fallbackMaterialName: string;
};

type ToolGroup = {
  libraryId: number;
  libraryName: string;
  tools: Array<{ id: string; name: string }>;
};

const ORIENTATION_OPTIONS = [
  {
    value: "vertical",
    label: "Vertical",
    hint: "X = short side, Y = length",
  },
  {
    value: "horizontal",
    label: "Horizontal",
    hint: "X = length, Y = short side",
  },
];

function classNames(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

function groupTools(tools: ToolItem[]): ToolGroup[] {
  const groups: ToolGroup[] = [];
  const groupIndex = new Map<number, number>();
  for (const tool of tools) {
    const existing = groupIndex.get(tool.libraryId);
    if (existing == null) {
      groupIndex.set(tool.libraryId, groups.length);
      groups.push({
        libraryId: tool.libraryId,
        libraryName: tool.libraryName,
        tools: [{ id: tool.id, name: tool.name }],
      });
      continue;
    }
    groups[existing].tools.push({ id: tool.id, name: tool.name });
  }
  return groups;
}

export function BoxTubeCamModal({
  open,
  loading,
  error,
  machines,
  selectedMachineId,
  onSelectMachine,
  availableTools,
  selectedToolIds,
  onToggleTool,
  onToggleToolLibrary,
  orientation,
  onSelectOrientation,
  onClose,
  onSubmit,
  materials,
  materialOverride,
  selectedMaterialId,
  onToggleMaterialOverride,
  onSelectMaterial,
  fallbackMaterialName,
}: BoxTubeCamModalProps) {
  const toolGroups = groupTools(availableTools);
  const selectedMaterial = materials.find(
    (material) => material.id === selectedMaterialId
  );
  const overrideMaterialName = selectedMaterial?.name ?? fallbackMaterialName;
  const materialDisplayName = materialOverride
    ? overrideMaterialName
    : `${fallbackMaterialName} (default)`;
  const formatOrientationLabel = (value?: string) =>
    value ? value.charAt(0).toUpperCase() + value.slice(1) : "Vertical";
  const [portalContainer] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    return document.createElement("div");
  });

  useEffect(() => {
    if (!portalContainer) return;
    document.body.appendChild(portalContainer);
    return () => {
      if (document.body.contains(portalContainer)) {
        document.body.removeChild(portalContainer);
      }
    };
  }, [portalContainer]);

  if (!portalContainer) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className={styles.camModalOverlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className={styles.camModal}
            initial={{ opacity: 0, scale: 0.98, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 12 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.camModalHeader}>
              <span>Start CAM</span>
              <button
                type="button"
                className={styles.camModalClose}
                onClick={onClose}
              >
                <Image
                  src="/settings/teams/X.svg"
                  alt="Close"
                  width={16}
                  height={16}
                />
              </button>
            </div>
            <div className={styles.camModalBody}>
              <div className={styles.camModalMain}>
                <div className={styles.camModalControls}>
                  <label className={styles.camModalLabel}>Machine</label>
                  {machines.length === 0 ? (
                    <div className={styles.camModalPlaceholder}>
                      {loading
                        ? "Loading machines..."
                        : "No box tube machines configured."}
                    </div>
                  ) : (
                    <div
                      className={styles.machineGrid}
                      role="radiogroup"
                      aria-label="Machine selection"
                    >
                      {machines.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          role="radio"
                          aria-checked={selectedMachineId === m.id}
                          className={classNames(
                            styles.machineOption,
                            selectedMachineId === m.id &&
                              styles.machineOptionSelected
                          )}
                          onClick={() => onSelectMachine(m.id)}
                          disabled={loading}
                        >
                          <span>{m.name}</span>
                          <span className={styles.machineOptionOrientation}>
                            {formatOrientationLabel(
                              m.box_tube_default_orientation
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.camModalControls}>
                  <label className={styles.camModalLabel}>Orientation</label>
                  <div
                    className={classNames(
                      styles.machineGrid,
                      styles.orientationGrid
                    )}
                  >
                    {ORIENTATION_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={classNames(
                          styles.machineOption,
                          styles.orientationOption,
                          orientation === option.value &&
                            styles.machineOptionSelected
                        )}
                        onClick={() => onSelectOrientation(option.value)}
                        disabled={loading}
                      >
                        <div className={styles.orientationOptionHeader}>
                          <span className={styles.orientationOptionTitle}>
                            {option.label}
                          </span>
                          <span className={styles.orientationOptionHint}>
                            {option.hint}
                          </span>
                        </div>
                        <div
                          className={classNames(
                            styles.orientationGraphic,
                            option.value === "horizontal" &&
                              styles.orientationGraphicHorizontal
                          )}
                        >
                          <div className={styles.orientationAxes}>
                            <span
                              className={classNames(
                                styles.orientationTubeOuter,
                                option.value === "horizontal" &&
                                  styles.orientationTubeHorizontal
                              )}
                            >
                              <span className={styles.orientationTubeInner} />
                            </span>
                            <span className={styles.orientationAxisX} />
                            <span className={styles.orientationAxisY} />
                            <span className={styles.orientationAxisLabelX}>
                              X
                            </span>
                            <span className={styles.orientationAxisLabelY}>
                              Y
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.camModalControls}>
                  <label className={styles.camModalLabel}>Material</label>
                  <div className={styles.camModalMaterialRow}>
                    <span className={styles.camModalMaterialValue}>
                      {materialDisplayName}
                    </span>
                    {materials.length > 0 && (
                      <button
                        type="button"
                        className={styles.camModalMaterialOverrideButton}
                        onClick={onToggleMaterialOverride}
                        disabled={loading}
                      >
                        {materialOverride ? "Close override" : "Override"}
                      </button>
                    )}
                  </div>
                  {materialOverride && materials.length > 0 && (
                    <select
                      className={styles.camModalMaterialSelect}
                      value={
                        selectedMaterialId ?? materials[0]?.id ?? ""
                      }
                      onChange={(event) =>
                        onSelectMaterial(Number(event.target.value))
                      }
                      disabled={loading}
                    >
                      {materials.map((material) => (
                        <option key={material.id} value={material.id}>
                          {material.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
              <div className={styles.camModalSide}>
                <div className={styles.camModalControls}>
                  <label className={styles.camModalLabel}>Tools</label>
                  {availableTools.length === 0 ? (
                    <div className={styles.camModalPlaceholder}>
                      {loading
                        ? "Loading tool libraries..."
                        : "No tools match this machine. Update your Tool Library in Settings → Fusion Inputs."}
                    </div>
                  ) : (
                    <div className={styles.camModalToolList}>
                      {toolGroups.map((group) => {
                        const toolIds = group.tools.map((tool) => tool.id);
                        const selectedCount = group.tools.filter((tool) =>
                          selectedToolIds.includes(tool.id)
                        ).length;
                        const allSelected =
                          toolIds.length > 0 &&
                          selectedCount === toolIds.length;
                        const someSelected =
                          selectedCount > 0 && !allSelected;
                        return (
                          <div
                            key={group.libraryId}
                            className={styles.camModalToolGroup}
                          >
                            <div className={styles.camModalToolGroupHeader}>
                              <div className={styles.camModalToolGroupTitle}>
                                <span>{group.libraryName}</span>
                                <span
                                  className={styles.camModalToolGroupCount}
                                >
                                  {selectedCount}/{toolIds.length} selected
                                </span>
                              </div>
                              <label className={styles.camModalToolGroupToggle}>
                                <input
                                  type="checkbox"
                                  checked={allSelected}
                                  ref={(input) => {
                                    if (input) {
                                      input.indeterminate =
                                        someSelected && !allSelected;
                                    }
                                  }}
                                  onChange={() => onToggleToolLibrary(toolIds)}
                                  disabled={loading || toolIds.length === 0}
                                />
                                <span>
                                  {allSelected ? "Clear all" : "Select all"}
                                </span>
                              </label>
                            </div>
                            <div className={styles.camModalToolGroupList}>
                              {group.tools.map((tool) => (
                                <label
                                  key={tool.id}
                                  className={styles.camModalToolOption}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedToolIds.includes(tool.id)}
                                    onChange={() => onToggleTool(tool.id)}
                                    disabled={loading}
                                  />
                                  <span>{tool.name}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {error ? <div className={styles.camModalError}>{error}</div> : null}
            <div className={styles.camModalFooter}>
              <button
                type="button"
                className={styles.camModalCancel}
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.camModalConfirm}
                onClick={onSubmit}
                disabled={
                  loading ||
                  selectedMachineId == null ||
                  availableTools.length === 0 ||
                  selectedToolIds.length === 0
                }
              >
                CAM
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    portalContainer
  );
}
