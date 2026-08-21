"use client";

import { ToolItem, TOOL_TYPES } from "../types";
import styles from "../ToolLibraryEditorModal.module.css";

interface BasicInfoSectionProps {
  tool: ToolItem;
  onChange: (updates: Partial<ToolItem>) => void;
}

export default function BasicInfoSection({ tool, onChange }: BasicInfoSectionProps) {
  return (
    <div>
      <div className={styles.defaultToolRow}>
        <label htmlFor={`default-tool-${tool.guid}`}>
          <input
            id={`default-tool-${tool.guid}`}
            type="checkbox"
            checked={Boolean(tool.default_selected)}
            onChange={(e) => onChange({ default_selected: e.target.checked })}
          />
          <span>Default tool</span>
        </label>
        <span className={styles.defaultToolHint}>Preselected in CAM</span>
      </div>

      <h3 className={styles.sectionTitle}>Basic Information</h3>

      <div className={styles.inputGroup}>
        <label>Description</label>
        <input
          type="text"
          className={styles.textInput}
          value={tool.description || ""}
          placeholder="e.g., 1/2 inch Flat End Mill"
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </div>

      <div className={styles.gridRow}>
        <div className={styles.inputGroup}>
          <label>Tool Type</label>
          <select
            className={styles.selectInput}
            value={tool.type || "flat end mill"}
            onChange={(e) => onChange({ type: e.target.value })}
          >
            {TOOL_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.inputGroup}>
          <label>Unit</label>
          <select
            className={styles.selectInput}
            value={tool.unit || "inches"}
            onChange={(e) => onChange({ unit: e.target.value as "inches" | "millimeters" })}
          >
            <option value="inches">Inches</option>
            <option value="millimeters">Millimeters</option>
          </select>
        </div>
      </div>

      <div className={styles.gridRow}>
        <div className={styles.inputGroup}>
          <label>Vendor</label>
          <input
            type="text"
            className={styles.textInput}
            value={tool.vendor || ""}
            placeholder="e.g., Harvey Tool"
            onChange={(e) => onChange({ vendor: e.target.value })}
          />
        </div>

        <div className={styles.inputGroup}>
          <label>Product ID</label>
          <input
            type="text"
            className={styles.textInput}
            value={tool["product-id"] || ""}
            placeholder="e.g., HT-12345"
            onChange={(e) => onChange({ "product-id": e.target.value })}
          />
        </div>
      </div>

      <div className={styles.inputGroup}>
        <label>Product Link</label>
        <input
          type="url"
          className={styles.textInput}
          value={tool["product-link"] || ""}
          placeholder="https://..."
          onChange={(e) => onChange({ "product-link": e.target.value })}
        />
      </div>

      <div className={styles.gridRow}>
        <div className={styles.inputGroup}>
          <label>Material Code (BMC)</label>
          <input
            type="text"
            className={styles.textInput}
            value={tool.BMC || ""}
            placeholder="e.g., carbide"
            onChange={(e) => onChange({ BMC: e.target.value })}
          />
        </div>

        <div className={styles.inputGroup}>
          <label>Grade</label>
          <input
            type="text"
            className={styles.textInput}
            value={tool.GRADE || ""}
            placeholder="e.g., general purpose"
            onChange={(e) => onChange({ GRADE: e.target.value })}
          />
        </div>
      </div>

      <div className={styles.inputGroup}>
        <label>GUID</label>
        <input
          type="text"
          className={styles.textInput}
          value={tool.guid || ""}
          disabled
          style={{ opacity: 0.6 }}
        />
      </div>
    </div>
  );
}
