import styles from "./platestocreate.module.css";
import { Plate } from "@/app/types";
import Image from "next/image";
import { motion } from "framer-motion";
import { useRef, useState } from "react";

export default function PlatesToCreate({
  plates,
  setPlates,
  categoryId,
  sectionId,
}: {
  plates: Plate[];
  setPlates: (plates: Plate[]) => void;
  categoryId: number;
  sectionId?: string;
}) {
  const pendingUpdates = useRef<Record<number, Partial<Plate>>>({});
  const saveTimeouts = useRef<Record<number, number>>({});
  const statusTimeouts = useRef<Record<number, number>>({});
  const [saveStatusByPlate, setSaveStatusByPlate] = useState<
    Record<number, "idle" | "saving" | "saved" | "error">
  >({});

  function setPlateStatus(
    plateId: number,
    status: "idle" | "saving" | "saved" | "error"
  ) {
    setSaveStatusByPlate((prev) => {
      if (prev[plateId] === status) return prev;
      return { ...prev, [plateId]: status };
    });
  }

  function queuePlateUpdate(plateId: number, update: Partial<Plate>) {
    if (!Number.isInteger(plateId)) return;
    pendingUpdates.current[plateId] = {
      ...pendingUpdates.current[plateId],
      ...update,
    };
    if (statusTimeouts.current[plateId]) {
      window.clearTimeout(statusTimeouts.current[plateId]);
      delete statusTimeouts.current[plateId];
    }
    setPlateStatus(plateId, "saving");
    if (saveTimeouts.current[plateId]) {
      window.clearTimeout(saveTimeouts.current[plateId]);
    }
    saveTimeouts.current[plateId] = window.setTimeout(async () => {
      const payload = pendingUpdates.current[plateId];
      delete pendingUpdates.current[plateId];
      delete saveTimeouts.current[plateId];
      if (!payload || Object.keys(payload).length === 0) return;
      try {
        const res = await fetch(`/api/plates/${plateId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          setPlateStatus(plateId, "error");
          console.error("Failed to update plate:", await res.text());
          statusTimeouts.current[plateId] = window.setTimeout(() => {
            setPlateStatus(plateId, "idle");
            delete statusTimeouts.current[plateId];
          }, 2500);
          return;
        }
        setPlateStatus(plateId, "saved");
        statusTimeouts.current[plateId] = window.setTimeout(() => {
          setPlateStatus(plateId, "idle");
          delete statusTimeouts.current[plateId];
        }, 2000);
      } catch (err) {
        console.error("Failed to update plate:", err);
        setPlateStatus(plateId, "error");
        statusTimeouts.current[plateId] = window.setTimeout(() => {
          setPlateStatus(plateId, "idle");
          delete statusTimeouts.current[plateId];
        }, 2500);
      }
    }, 400);
  }

  return (
    <div className={styles.container} id={sectionId}>
      <h1 className={styles.title}>Plates To Create</h1>
      <div
        onClick={() =>
          setPlates([
            ...plates,
            {
              name: "",
              width: 24,
              length: 48,
              true_depth: 0.25,
              category_id: categoryId,
              id: Math.random() * 1000000,
            },
          ])
        }
        className={styles.addButton}
      >
        <Image
          src="/mat_thickness/add.svg"
          alt="Add Plate"
          width={2000}
          height={2000}
          className={styles.addIcon}
        />
      </div>
      <div className={styles.platesList}>
        {plates.length > 0 ? (
          plates.map((plate, index) => (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              key={index}
              className={styles.plateItem}
            >
              <div className={styles.plateHeader}>
                <hr />
                <span>Plate {index + 1}</span>
                {saveStatusByPlate[plate.id] === "saving" ? (
                  <span className={`${styles.saveStatus} ${styles.saving}`}>
                    Saving...
                  </span>
                ) : null}
                {saveStatusByPlate[plate.id] === "saved" ? (
                  <span className={`${styles.saveStatus} ${styles.saved}`}>
                    Saved
                  </span>
                ) : null}
                {saveStatusByPlate[plate.id] === "error" ? (
                  <span className={`${styles.saveStatus} ${styles.error}`}>
                    Save failed
                  </span>
                ) : null}
              </div>
              <div className={styles.plateWidth}>
                <span>Width</span>
                <input
                  type="number"
                  min="0"
                  value={Number.isFinite(plate.width) ? plate.width : ""}
                  onChange={(e) => {
                    const newPlates = [...plates];
                    newPlates[index].width = Number(e.target.value);
                    setPlates(newPlates);
                    queuePlateUpdate(plate.id, {
                      width: newPlates[index].width,
                    });
                  }}
                />
              </div>
              <div className={styles.plateHeight}>
                <span>Height</span>
                <input
                  type="number"
                  min="0"
                  value={Number.isFinite(plate.length) ? plate.length : ""}
                  onChange={(e) => {
                    const newPlates = [...plates];
                    newPlates[index].length = Number(e.target.value);
                    setPlates(newPlates);
                    queuePlateUpdate(plate.id, {
                      length: newPlates[index].length,
                    });
                  }}
                />
              </div>
              <div className={styles.plateTrueDepth}>
                <span>True Depth</span>
                <input
                  type="number"
                  min="0"
                  value={
                    Number.isFinite(plate.true_depth) ? plate.true_depth : ""
                  }
                  onChange={(e) => {
                    const newPlates = [...plates];
                    newPlates[index].true_depth = Number(e.target.value);
                    setPlates(newPlates);
                    queuePlateUpdate(plate.id, {
                      true_depth: newPlates[index].true_depth,
                    });
                  }}
                />
              </div>
              <div className={styles.deletePlate}>
                <Image
                  src="/mat_thickness/delete.svg"
                  alt="Delete Plate"
                  width={2000}
                  height={2000}
                  className={styles.deleteIcon}
                  onClick={() => {
                    const newPlates = plates.filter((_, i) => i !== index);
                    setPlates(newPlates);
                  }}
                />
              </div>
            </motion.div>
          ))
        ) : (
          <div className={styles.noPlatesMessage} />
        )}
      </div>
    </div>
  );
}
