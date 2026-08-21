"use client";

import { PostProcessSettings } from "../types";
import styles from "../ToolLibraryEditorModal.module.css";

interface PostProcessSectionProps {
  postProcess: PostProcessSettings;
  onChange: (updates: PostProcessSettings) => void;
}

export default function PostProcessSection({ postProcess, onChange }: PostProcessSectionProps) {
  const handleChange = (key: keyof PostProcessSettings, value: number | boolean | string) => {
    onChange({ ...postProcess, [key]: value });
  };

  const handleNumberChange = (key: keyof PostProcessSettings, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      handleChange(key, num);
    } else if (value === "") {
      const newPostProcess = { ...postProcess };
      delete newPostProcess[key];
      onChange(newPostProcess);
    }
  };

  return (
    <div>
      <h3 className={styles.sectionTitle}>Post-Process Settings</h3>

      <div className={styles.gridRow3}>
        <div className={styles.inputGroup}>
          <label>Tool Number</label>
          <input
            type="number"
            className={styles.numberInput}
            value={postProcess.number ?? ""}
            step="1"
            min="1"
            placeholder="1"
            onChange={(e) => handleNumberChange("number", e.target.value)}
          />
        </div>

        <div className={styles.inputGroup}>
          <label>Turret Position</label>
          <input
            type="number"
            className={styles.numberInput}
            value={postProcess.turret ?? ""}
            step="1"
            min="0"
            placeholder="0"
            onChange={(e) => handleNumberChange("turret", e.target.value)}
          />
        </div>

        <div className={styles.inputGroup}>
          <label>Diameter Offset</label>
          <input
            type="number"
            className={styles.numberInput}
            value={postProcess["diameter-offset"] ?? ""}
            step="1"
            min="1"
            placeholder="1"
            onChange={(e) => handleNumberChange("diameter-offset", e.target.value)}
          />
        </div>
      </div>

      <div className={styles.inputGroup}>
        <label>Length Offset</label>
        <input
          type="number"
          className={styles.numberInput}
          value={postProcess["length-offset"] ?? ""}
          step="1"
          min="1"
          placeholder="1"
          onChange={(e) => handleNumberChange("length-offset", e.target.value)}
        />
      </div>

      <div className={styles.inputGroup}>
        <label>Comment</label>
        <input
          type="text"
          className={styles.textInput}
          value={postProcess.comment ?? ""}
          placeholder="NC program comment..."
          onChange={(e) => handleChange("comment", e.target.value)}
        />
      </div>

      <h3 className={styles.sectionTitle} style={{ marginTop: "32px" }}>Tool Options</h3>

      <div className={styles.gridRow}>
        <div className={styles.checkboxGroup}>
          <input
            type="checkbox"
            id="manualToolChange"
            checked={postProcess["manual-tool-change"] ?? false}
            onChange={(e) => handleChange("manual-tool-change", e.target.checked)}
          />
          <label htmlFor="manualToolChange">Manual Tool Change</label>
        </div>

        <div className={styles.checkboxGroup}>
          <input
            type="checkbox"
            id="breakControl"
            checked={postProcess["break-control"] ?? false}
            onChange={(e) => handleChange("break-control", e.target.checked)}
          />
          <label htmlFor="breakControl">Break Control</label>
        </div>
      </div>

      <div className={styles.checkboxGroup}>
        <input
          type="checkbox"
          id="live"
          checked={postProcess.live ?? false}
          onChange={(e) => handleChange("live", e.target.checked)}
        />
        <label htmlFor="live">Live Tool</label>
      </div>
    </div>
  );
}
