"use client";

import { ToolGeometry } from "../types";
import styles from "../ToolLibraryEditorModal.module.css";

interface GeometrySectionProps {
  geometry: ToolGeometry;
  unit: "inches" | "millimeters";
  onChange: (updates: ToolGeometry) => void;
}

export default function GeometrySection({ geometry, unit, onChange }: GeometrySectionProps) {
  const unitLabel = unit === "inches" ? "in" : "mm";

  const handleChange = (key: keyof ToolGeometry, value: number | boolean) => {
    onChange({ ...geometry, [key]: value });
  };

  const handleNumberChange = (key: keyof ToolGeometry, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      handleChange(key, num);
    } else if (value === "") {
      const newGeometry = { ...geometry };
      delete newGeometry[key];
      onChange(newGeometry);
    }
  };

  return (
    <div>
      <h3 className={styles.sectionTitle}>Tool Geometry</h3>

      <div className={styles.gridRow}>
        <div className={styles.inputGroup}>
          <label>Diameter (DC)</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry.DC ?? ""}
              step="0.001"
              min="0"
              placeholder="0.250"
              onChange={(e) => handleNumberChange("DC", e.target.value)}
            />
            <span>{unitLabel}</span>
          </div>
        </div>

        <div className={styles.inputGroup}>
          <label>Overall Length (OAL)</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry.OAL ?? ""}
              step="0.01"
              min="0"
              placeholder="3.000"
              onChange={(e) => handleNumberChange("OAL", e.target.value)}
            />
            <span>{unitLabel}</span>
          </div>
        </div>
      </div>

      <div className={styles.gridRow}>
        <div className={styles.inputGroup}>
          <label>Body Length (LB)</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry.LB ?? ""}
              step="0.01"
              min="0"
              placeholder="1.500"
              onChange={(e) => handleNumberChange("LB", e.target.value)}
            />
            <span>{unitLabel}</span>
          </div>
        </div>

        <div className={styles.inputGroup}>
          <label>Flute Length (LCF)</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry.LCF ?? ""}
              step="0.01"
              min="0"
              placeholder="1.000"
              onChange={(e) => handleNumberChange("LCF", e.target.value)}
            />
            <span>{unitLabel}</span>
          </div>
        </div>
      </div>

      <div className={styles.gridRow}>
        <div className={styles.inputGroup}>
          <label>Number of Flutes (NOF)</label>
          <input
            type="number"
            className={styles.numberInput}
            value={geometry.NOF ?? ""}
            step="1"
            min="1"
            max="20"
            placeholder="4"
            onChange={(e) => handleNumberChange("NOF", e.target.value)}
          />
        </div>

        <div className={styles.inputGroup}>
          <label>Shaft Diameter (SFDM)</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry.SFDM ?? ""}
              step="0.001"
              min="0"
              placeholder="0.250"
              onChange={(e) => handleNumberChange("SFDM", e.target.value)}
            />
            <span>{unitLabel}</span>
          </div>
        </div>
      </div>

      <div className={styles.gridRow}>
        <div className={styles.inputGroup}>
          <label>Shoulder Length</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry["shoulder-length"] ?? ""}
              step="0.01"
              min="0"
              placeholder="1.250"
              onChange={(e) => handleNumberChange("shoulder-length", e.target.value)}
            />
            <span>{unitLabel}</span>
          </div>
        </div>

        <div className={styles.inputGroup}>
          <label>Shoulder Diameter</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry["shoulder-diameter"] ?? ""}
              step="0.001"
              min="0"
              placeholder="0.375"
              onChange={(e) => handleNumberChange("shoulder-diameter", e.target.value)}
            />
            <span>{unitLabel}</span>
          </div>
        </div>
      </div>

      <div className={styles.gridRow}>
        <div className={styles.inputGroup}>
          <label>Corner Radius (RE)</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry.RE ?? ""}
              step="0.001"
              min="0"
              placeholder="0.000"
              onChange={(e) => handleNumberChange("RE", e.target.value)}
            />
            <span>{unitLabel}</span>
          </div>
        </div>

        <div className={styles.inputGroup}>
          <label>Tip Angle (SIG)</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry.SIG ?? ""}
              step="1"
              min="0"
              max="180"
              placeholder="118"
              onChange={(e) => handleNumberChange("SIG", e.target.value)}
            />
            <span>deg</span>
          </div>
        </div>
      </div>

      <div className={styles.gridRow}>
        <div className={styles.inputGroup}>
          <label>Thread Pitch (TP)</label>
          <input
            type="number"
            className={styles.numberInput}
            value={geometry.TP ?? ""}
            step="0.001"
            min="0"
            placeholder="0.000"
            onChange={(e) => handleNumberChange("TP", e.target.value)}
          />
        </div>

        <div className={styles.inputGroup}>
          <label>Thread Profile Angle</label>
          <div className={styles.unitSuffix}>
            <input
              type="number"
              className={styles.numberInput}
              value={geometry["thread-profile-angle"] ?? ""}
              step="1"
              min="0"
              max="180"
              placeholder="60"
              onChange={(e) => handleNumberChange("thread-profile-angle", e.target.value)}
            />
            <span>deg</span>
          </div>
        </div>
      </div>

      <div className={styles.gridRow}>
        <div className={styles.checkboxGroup}>
          <input
            type="checkbox"
            id="hand"
            checked={geometry.HAND ?? true}
            onChange={(e) => handleChange("HAND", e.target.checked)}
          />
          <label htmlFor="hand">Right-Handed</label>
        </div>

        <div className={styles.checkboxGroup}>
          <input
            type="checkbox"
            id="csp"
            checked={geometry.CSP ?? false}
            onChange={(e) => handleChange("CSP", e.target.checked)}
          />
          <label htmlFor="csp">Coolant Supply Port</label>
        </div>
      </div>
    </div>
  );
}
