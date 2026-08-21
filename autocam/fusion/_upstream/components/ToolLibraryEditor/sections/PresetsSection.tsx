"use client";

import { useState } from "react";
import { Preset, COOLANT_OPTIONS, createEmptyPreset } from "../types";
import styles from "../ToolLibraryEditorModal.module.css";

interface PresetsSectionProps {
  presets: Preset[];
  unit: "inches" | "millimeters";
  onChange: (presets: Preset[]) => void;
}

export default function PresetsSection({ presets, unit, onChange }: PresetsSectionProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(
    presets.length > 0 ? 0 : null
  );

  const unitLabel = unit === "inches" ? "in" : "mm";
  const feedUnit = unit === "inches" ? "in/min" : "mm/min";

  const handlePresetChange = (index: number, updates: Partial<Preset>) => {
    const newPresets = [...presets];
    newPresets[index] = { ...newPresets[index], ...updates };
    onChange(newPresets);
  };

  const handleAddPreset = () => {
    const newPreset = createEmptyPreset();
    onChange([...presets, newPreset]);
    setExpandedIndex(presets.length);
  };

  const handleDeletePreset = (index: number) => {
    const newPresets = presets.filter((_, i) => i !== index);
    onChange(newPresets);
    if (expandedIndex === index) {
      setExpandedIndex(newPresets.length > 0 ? 0 : null);
    } else if (expandedIndex !== null && expandedIndex > index) {
      setExpandedIndex(expandedIndex - 1);
    }
  };

  const handleNumberChange = (
    index: number,
    key: keyof Preset,
    value: string
  ) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      handlePresetChange(index, { [key]: num });
    } else if (value === "") {
      const newPresets = [...presets];
      const newPreset = { ...newPresets[index] };
      delete (newPreset as Record<string, unknown>)[key];
      newPresets[index] = newPreset;
      onChange(newPresets);
    }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <h3 className={styles.sectionTitle} style={{ marginBottom: 0, paddingBottom: 0, borderBottom: "none" }}>
          Cutting Presets
        </h3>
        <button
          type="button"
          onClick={handleAddPreset}
          style={{
            background: "none",
            border: "1px solid #444",
            borderRadius: "6px",
            padding: "8px 16px",
            color: "#a1a1a1",
            cursor: "pointer",
            fontSize: "13px",
            fontFamily: "var(--font-roboto)",
          }}
        >
          Add Preset
        </button>
      </div>

      {presets.length === 0 ? (
        <div style={{ color: "#666", textAlign: "center", padding: "32px 0" }}>
          No presets. Click &quot;Add Preset&quot; to create one.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {presets.map((preset, index) => (
            <div
              key={preset.guid || index}
              style={{
                border: "1px solid #333",
                borderRadius: "8px",
                overflow: "hidden",
              }}
            >
              {/* Preset Header */}
              <div
                onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px",
                  cursor: "pointer",
                  backgroundColor: expandedIndex === index ? "rgba(230, 221, 94, 0.05)" : "transparent",
                }}
              >
                <div>
                  <div style={{ color: "white", fontWeight: 500, marginBottom: "4px" }}>
                    {preset.name || "Unnamed Preset"}
                  </div>
                  <div style={{ color: "#666", fontSize: "12px" }}>
                    {preset.n ? `${preset.n} RPM` : "No RPM set"}
                    {preset.v_f ? ` | ${preset.v_f} ${feedUnit}` : ""}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeletePreset(index);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#dc2626",
                      cursor: "pointer",
                      padding: "4px 8px",
                      fontSize: "12px",
                    }}
                  >
                    Delete
                  </button>
                  <span style={{ color: "#666", transform: expandedIndex === index ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
                    ▼
                  </span>
                </div>
              </div>

              {/* Preset Content */}
              {expandedIndex === index && (
                <div style={{ padding: "16px", borderTop: "1px solid #333", backgroundColor: "#0d0d0d" }}>
                  <div className={styles.gridRow}>
                    <div className={styles.inputGroup}>
                      <label>Preset Name</label>
                      <input
                        type="text"
                        className={styles.textInput}
                        value={preset.name || ""}
                        placeholder="e.g., Aluminum, Default"
                        onChange={(e) => handlePresetChange(index, { name: e.target.value })}
                      />
                    </div>

                    <div className={styles.inputGroup}>
                      <label>Coolant</label>
                      <select
                        className={styles.selectInput}
                        value={preset["tool-coolant"] || "disabled"}
                        onChange={(e) => handlePresetChange(index, { "tool-coolant": e.target.value })}
                      >
                        {COOLANT_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option.charAt(0).toUpperCase() + option.slice(1).replace(/-/g, " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <h4 style={{ color: "#a1a1a1", fontSize: "13px", fontWeight: 600, marginTop: "20px", marginBottom: "16px" }}>
                    Spindle & Feed
                  </h4>

                  <div className={styles.gridRow}>
                    <div className={styles.inputGroup}>
                      <label>Spindle Speed (RPM)</label>
                      <input
                        type="number"
                        className={styles.numberInput}
                        value={preset.n ?? ""}
                        step="100"
                        min="0"
                        placeholder="10000"
                        onChange={(e) => handleNumberChange(index, "n", e.target.value)}
                      />
                    </div>

                    <div className={styles.inputGroup}>
                      <label>Ramp Spindle Speed</label>
                      <input
                        type="number"
                        className={styles.numberInput}
                        value={preset.n_ramp ?? ""}
                        step="100"
                        min="0"
                        placeholder="10000"
                        onChange={(e) => handleNumberChange(index, "n_ramp", e.target.value)}
                      />
                    </div>
                  </div>

                  <div className={styles.gridRow}>
                    <div className={styles.inputGroup}>
                      <label>Cutting Feed Rate</label>
                      <div className={styles.unitSuffix}>
                        <input
                          type="number"
                          className={styles.numberInput}
                          value={preset.v_f ?? ""}
                          step="1"
                          min="0"
                          placeholder="50"
                          onChange={(e) => handleNumberChange(index, "v_f", e.target.value)}
                        />
                        <span>{feedUnit}</span>
                      </div>
                    </div>

                    <div className={styles.inputGroup}>
                      <label>Plunge Feed Rate</label>
                      <div className={styles.unitSuffix}>
                        <input
                          type="number"
                          className={styles.numberInput}
                          value={preset.v_f_plunge ?? ""}
                          step="1"
                          min="0"
                          placeholder="25"
                          onChange={(e) => handleNumberChange(index, "v_f_plunge", e.target.value)}
                        />
                        <span>{feedUnit}</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.gridRow}>
                    <div className={styles.inputGroup}>
                      <label>Ramp Feed Rate</label>
                      <div className={styles.unitSuffix}>
                        <input
                          type="number"
                          className={styles.numberInput}
                          value={preset.v_f_ramp ?? ""}
                          step="1"
                          min="0"
                          placeholder="25"
                          onChange={(e) => handleNumberChange(index, "v_f_ramp", e.target.value)}
                        />
                        <span>{feedUnit}</span>
                      </div>
                    </div>

                    <div className={styles.inputGroup}>
                      <label>Retract Feed Rate</label>
                      <div className={styles.unitSuffix}>
                        <input
                          type="number"
                          className={styles.numberInput}
                          value={preset.v_f_retract ?? ""}
                          step="1"
                          min="0"
                          placeholder="40"
                          onChange={(e) => handleNumberChange(index, "v_f_retract", e.target.value)}
                        />
                        <span>{feedUnit}</span>
                      </div>
                    </div>
                  </div>

                  <h4 style={{ color: "#a1a1a1", fontSize: "13px", fontWeight: 600, marginTop: "20px", marginBottom: "16px" }}>
                    Depth & Width
                  </h4>

                  <div className={styles.gridRow}>
                    <div className={styles.inputGroup}>
                      <label>Stepdown (Depth of Cut)</label>
                      <div className={styles.unitSuffix}>
                        <input
                          type="number"
                          className={styles.numberInput}
                          value={preset.stepdown ?? ""}
                          step="0.001"
                          min="0"
                          placeholder="0.100"
                          onChange={(e) => handleNumberChange(index, "stepdown", e.target.value)}
                        />
                        <span>{unitLabel}</span>
                      </div>
                    </div>

                    <div className={styles.inputGroup}>
                      <label>Stepover (Width of Cut)</label>
                      <div className={styles.unitSuffix}>
                        <input
                          type="number"
                          className={styles.numberInput}
                          value={preset.stepover ?? ""}
                          step="0.001"
                          min="0"
                          placeholder="0.125"
                          onChange={(e) => handleNumberChange(index, "stepover", e.target.value)}
                        />
                        <span>{unitLabel}</span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.inputGroup}>
                    <label>Ramp Angle</label>
                    <div className={styles.unitSuffix}>
                      <input
                        type="number"
                        className={styles.numberInput}
                        value={preset["ramp-angle"] ?? ""}
                        step="1"
                        min="0"
                        max="90"
                        placeholder="10"
                        onChange={(e) => handleNumberChange(index, "ramp-angle", e.target.value)}
                      />
                      <span>deg</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
