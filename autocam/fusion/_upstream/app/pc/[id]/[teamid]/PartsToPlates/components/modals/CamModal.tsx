"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import styles from "../../partstoplates.module.css";
import { classNames } from "../helpers";
import { ModalPortal } from "./ModalPortal";

type CamModalProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  machines: Array<{ id: number; name: string }>;
  selectedMachineId: number | null;
  camFileUrl: string | null;
  camFileType: "image" | "pdf" | "other" | null;
  onClose: () => void;
  onSelectMachine: (machineId: number) => void;
  onSubmit: () => void;
  availableTools: Array<{
    id: string;
    name: string;
    libraryId: number;
    libraryName: string;
  }>;
  selectedToolIds: string[];
  onToggleTool: (toolId: string) => void;
  onToggleToolLibrary: (toolIds: string[]) => void;
  arrangeDimensions: { width: number; length: number } | null;
  trueDepthValue: string;
  trueDepthStatus: "idle" | "saving" | "saved" | "error";
  onTrueDepthChange: (value: string) => void;
};

type ToolGroup = {
  libraryId: number;
  libraryName: string;
  tools: Array<{
    id: string;
    name: string;
  }>;
};

function groupTools(
  tools: CamModalProps["availableTools"]
): Array<ToolGroup> {
  const groups: ToolGroup[] = [];
  const groupIndex = new Map<number, number>();
  for (const tool of tools) {
    const existingIndex = groupIndex.get(tool.libraryId);
    if (existingIndex == null) {
      groupIndex.set(tool.libraryId, groups.length);
      groups.push({
        libraryId: tool.libraryId,
        libraryName: tool.libraryName,
        tools: [{ id: tool.id, name: tool.name }],
      });
      continue;
    }
    groups[existingIndex].tools.push({ id: tool.id, name: tool.name });
  }
  return groups;
}

export function CamModal({
  open,
  loading,
  error,
  machines,
  selectedMachineId,
  camFileUrl,
  camFileType,
  onClose,
  onSelectMachine,
  onSubmit,
  availableTools,
  selectedToolIds,
  onToggleTool,
  onToggleToolLibrary,
  arrangeDimensions,
  trueDepthValue,
  trueDepthStatus,
  onTrueDepthChange,
}: CamModalProps) {
  const toolGroups = groupTools(availableTools);
  const trueDepthStatusText =
    trueDepthStatus === "saving"
      ? "Saving..."
      : trueDepthStatus === "saved"
      ? "Auto Saved"
      : trueDepthStatus === "error"
      ? "Save failed"
      : "";

  return (
    <ModalPortal>
      <AnimatePresence>
        {open && (
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
                  <div className={styles.camModalScreenshot}>
                    {loading ? (
                      <div className={styles.camModalPlaceholder}>Loading…</div>
                    ) : camFileUrl ? (
                      camFileType === "image" ? (
                        <div style={{ display: "grid", gap: 8 }}>
                          <img
                            src={camFileUrl}
                            alt="Arrangement screenshot"
                            className={styles.camModalImage}
                          />
                        </div>
                      ) : (
                        <div className={styles.camModalPlaceholder}>
                          <div>No preview available.</div>
                          <div
                            style={{
                              display: "flex",
                              gap: 10,
                              justifyContent: "center",
                              marginTop: 8,
                            }}
                          >
                            <a href={camFileUrl} target="_blank" rel="noreferrer">
                              Open
                            </a>
                            <a href={camFileUrl} download>
                              Download
                            </a>
                          </div>
                        </div>
                      )
                    ) : (
                      <div className={styles.camModalPlaceholder}>
                        No screenshot available.
                      </div>
                    )}
                  </div>
                  {arrangeDimensions ? (
                    <div className={styles.camModalMetaCard}>
                      <div className={styles.camModalMetaRow}>
                        <span className={styles.camModalMetaLabel}>
                          Arrange Dimensions
                        </span>
                        <span className={styles.camModalMetaValue}>
                          {arrangeDimensions.width} x {arrangeDimensions.length}
                        </span>
                      </div>
                      <div className={styles.camModalMetaRow}>
                        <span className={styles.camModalMetaLabel}>
                          True Depth
                        </span>
                        <div className={styles.camModalDepthControl}>
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            className={styles.camModalDepthInput}
                            value={trueDepthValue}
                            onChange={(e) => onTrueDepthChange(e.target.value)}
                          />
                          {trueDepthStatusText ? (
                            <span
                              className={`${styles.camModalDepthStatus} ${
                                trueDepthStatus === "saved"
                                  ? styles.camModalDepthStatusSaved
                                  : trueDepthStatus === "error"
                                  ? styles.camModalDepthStatusError
                                  : ""
                              }`}
                            >
                              {trueDepthStatusText}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className={styles.camModalControls}>
                    <label className={styles.camModalLabel}>Machine</label>
                    {machines.length === 0 ? (
                      <div className={styles.camModalPlaceholder}>
                        {loading
                          ? "Loading machines…"
                          : "No plate-capable machines configured for this team."}
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
                            {m.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className={styles.camModalSide}>
                  <div className={styles.camModalControls}>
                    <label className={styles.camModalLabel}>Tools</label>
                    {availableTools.length === 0 ? (
                      <div className={styles.camModalPlaceholder}>
                        No tools match this machine/material. Update your Tool
                        Library in Settings → Fusion Inputs.
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
                                <label
                                  className={styles.camModalToolGroupToggle}
                                >
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
                  Start CAM
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
