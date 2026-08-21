"use client";
import styles from "./availableparts.module.css";
import { Part } from "@/app/types";
import { useEffect, useCallback, ChangeEvent } from "react";
import { useMaterialEvents } from "../materialEvents";

export default function AvailableParts({
  epicsMap,
  sectionId,
}: {
  epicsMap: { [key: string]: Part[] };
  sectionId?: string;
}) {
  const {
    selectedParts,
    setSelectedParts,
    setUnassignedParts,
    unassignedParts,
    plates,
    setPartsToPlates,
  } = useMaterialEvents();

  // Deduct debt from plates, newest to oldest
  const deductFromPlates = useCallback(
    (partId: number, debt: number) => {
      if (debt <= 0) return;

      setPartsToPlates((prevPartsToPlates) => {
        const newPartsToPlates = { ...prevPartsToPlates };
        let remainingDebt = debt;

        // Iterate plates from newest (end) to oldest (beginning)
        for (let i = plates.length - 1; i >= 0 && remainingDebt > 0; i--) {
          const plateId = plates[i].id;
          const plateParts = newPartsToPlates[plateId];

          if (!plateParts) continue;

          const partIndex = plateParts.findIndex((p) => p.partId === partId);
          if (partIndex === -1) continue;

          const partEntry = plateParts[partIndex];
          const deduction = Math.min(partEntry.quantity, remainingDebt);

          if (deduction > 0) {
            newPartsToPlates[plateId] = plateParts.map((p, idx) =>
              idx === partIndex
                ? { ...p, quantity: p.quantity - deduction }
                : p
            );
            remainingDebt -= deduction;
          }
        }

        return newPartsToPlates;
      });

      // After deducting from plates, reset unassigned to 0 (debt is now paid)
      setUnassignedParts((prev) => ({
        ...prev,
        [partId]: Math.max(prev[partId], 0),
      }));
    },
    [plates, setPartsToPlates, setUnassignedParts]
  );
  useEffect(() => {
    Object.entries(epicsMap).forEach(([, parts]) =>
      parts.forEach((part) => {
        setUnassignedParts((obj) => ({ ...obj, [part.id]: 0 }));
        setSelectedParts((obj) => ({ ...obj, [part.id]: 0 }));
      })
    );
  }, [epicsMap, setSelectedParts, setUnassignedParts]);
  return (
    <div className={styles.container} id={sectionId}>
      <div className={styles.header}>
        <h1 id={styles.title}>Available Parts</h1>
        <button
          onClick={() => {
            setUnassignedParts((obj) => {
              const newObj = { ...obj };
              Object.keys(newObj).forEach((key) => {
                const partId = Number(key);
                let recommendedQuantity = 0;
                Object.values(epicsMap).forEach((parts) => {
                  parts.forEach((part) => {
                    if (part.id === partId) {
                      recommendedQuantity =
                        part.quantity -
                        selectedParts[partId] +
                        unassignedParts[partId];
                    }
                  });
                });
                newObj[partId] = recommendedQuantity;
              });
              return newObj;
            });
            setSelectedParts((obj) => {
              const newObj = { ...obj };
              Object.keys(newObj).forEach((key) => {
                const partId = Number(key);
                let recommendedQuantity = 0;
                Object.values(epicsMap).forEach((parts) => {
                  parts.forEach((part) => {
                    if (part.id === partId) {
                      recommendedQuantity = part.quantity;
                    }
                  });
                });
                newObj[partId] = recommendedQuantity;
              });
              return newObj;
            });
          }}
        >
          Select All
        </button>
      </div>
      {Object.entries(epicsMap).map(([epic, parts]) => (
        <div key={epic}>
          <h2 className={styles.epicTitle}>{epic}</h2>
          <div>
            {parts.map((part) => (
              <div key={part.id} className={styles.partRow}>
                <div className={styles.partDetails}>
                  <span className={styles.partNumber}>{part.name}</span>
                  <span className={styles.recommendedQuantity}>
                    Recommended Quantity: {part.quantity}
                  </span>
                </div>
                <div className={styles.counter}>
                  <button
                    className={styles.counterButtonMinus}
                    onClick={() => {
                      const prevSelected = selectedParts[part.id] || 0;
                      const newSelected = Math.max(prevSelected - 1, 0);
                      const delta = newSelected - prevSelected;

                      setSelectedParts((obj) => ({
                        ...obj,
                        [part.id]: newSelected,
                      }));

                      const newUnassigned =
                        (unassignedParts[part.id] || 0) + delta;
                      setUnassignedParts((obj) => ({
                        ...obj,
                        [part.id]: newUnassigned,
                      }));

                      // If unassigned went negative, deduct from plates
                      if (newUnassigned < 0) {
                        deductFromPlates(part.id, Math.abs(newUnassigned));
                      }
                    }}
                  >
                    -
                  </button>
                  <input
                    className={styles.counterValue}
                    type="number"
                    value={selectedParts[part.id] || 0}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const prevSelected = selectedParts[part.id] || 0;
                      const newSelected = Math.max(Number(e.target.value), 0);
                      const delta = newSelected - prevSelected;

                      setSelectedParts((obj) => ({
                        ...obj,
                        [part.id]: newSelected,
                      }));

                      const newUnassigned =
                        (unassignedParts[part.id] || 0) + delta;
                      setUnassignedParts((obj) => ({
                        ...obj,
                        [part.id]: newUnassigned,
                      }));

                      // If unassigned went negative, deduct from plates
                      if (newUnassigned < 0) {
                        deductFromPlates(part.id, Math.abs(newUnassigned));
                      }
                    }}
                  />
                  <button
                    className={styles.counterButtonPlus}
                    onClick={() => {
                      const prevSelected = selectedParts[part.id] || 0;
                      const newSelected = prevSelected + 1;
                      const delta = newSelected - prevSelected; // Always +1

                      setSelectedParts((obj) => ({
                        ...obj,
                        [part.id]: newSelected,
                      }));

                      const newUnassigned =
                        (unassignedParts[part.id] || 0) + delta;
                      setUnassignedParts((obj) => ({
                        ...obj,
                        [part.id]: newUnassigned,
                      }));

                      // If unassigned went negative, deduct from plates
                      if (newUnassigned < 0) {
                        deductFromPlates(part.id, Math.abs(newUnassigned));
                      }
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
