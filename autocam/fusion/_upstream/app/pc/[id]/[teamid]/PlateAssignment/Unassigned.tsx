import styles from "./plateassignment.module.css";
import { useMaterialEvents } from "../materialEvents";
import Image from "next/image";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export function Unassigned({
  loading = false,
  sectionId,
}: {
  loading?: boolean;
  sectionId?: string;
}) {
  const {
    unassignedParts,
    setUnassignedParts,
    partsToPlates,
    setPartsToPlates,
  } = useMaterialEvents();
  const unassignedEntries = useMemo(
    () =>
      Object.entries(unassignedParts).filter(([, quantity]) => quantity > 0),
    [unassignedParts]
  );
  function onReceive(data: {
    partId: number;
    quantity: number;
    from?: number;
  }) {
    if (!partsToPlates || !setPartsToPlates) return;
    if (data.from == null) return;

    const oldPlateId = data.from;
    setPartsToPlates((prev) => {
      const next = { ...prev };
      const oldPlate = next[oldPlateId] ?? [];
      next[oldPlateId] = oldPlate
        .map((part) =>
          part.partId === data.partId
            ? { partId: part.partId, quantity: part.quantity - data.quantity }
            : part
        )
        .filter((part) => part.quantity > 0);
      return next;
    });

    setUnassignedParts((prev) => ({
      ...prev,
      [data.partId]: (prev[data.partId] ?? 0) + data.quantity,
    }));
  }
  return (
    <div
      className={styles.container}
      id={sectionId}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData("application/json");
        if (!raw) return;

        const data = JSON.parse(raw);
        onReceive(data);
      }}
    >
      <h1 className={styles.title}>Unassigned</h1>
      <div className={styles.dropZoneOutline} aria-hidden="true" />
      <div className={styles.dropZoneLabel} aria-hidden="true">
        Drag parts here
      </div>
      <div className={styles.cardsContainer}>
        {loading
          ? Array.from({ length: 3 }).map((_, index) => (
              <div className={styles.skeletonCard} key={`skeleton-${index}`}>
                <div className={styles.skeletonBlock} />
                <div className={styles.skeletonBlockShort} />
              </div>
            ))
          : unassignedEntries.map(([partId]) => (
              <UnassignedCard key={partId} partId={Number(partId)} />
            ))}
      </div>
    </div>
  );
}

function UnassignedCard({ partId }: { partId: number }) {
  const { parts, unassignedParts } = useMaterialEvents();
  const part = parts.find((p) => p.id === partId);
  const quantity = unassignedParts[partId];
  const [expanded, setExpanded] = useState(false);
  const handleDragStart = (e: React.DragEvent<HTMLElement>, many: number) => {
    const payload = { partId, quantity: many };
    e.dataTransfer.setData("application/json", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
    const el = e.currentTarget;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.position = "fixed";
    clone.style.top = "-1000px";
    clone.style.left = "-1000px";
    clone.style.pointerEvents = "none";
    clone.style.width = `${el.getBoundingClientRect().width}px`;
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, 20, 20);
    requestAnimationFrame(() => document.body.removeChild(clone));
  };
  return (
    <div className={styles.card}>
      <div
        className={styles.cardHeader}
        draggable
        onDragStart={(e) => handleDragStart(e, quantity)}
      >
        <span>{part?.name}</span>
        <span className={styles.cardHeaderQuantity}>{quantity}</span>
        <Image
          src={"/mat_thickness/Dropdown.svg"}
          alt={"Dropdown"}
          width={2000}
          height={2000}
          id={styles.dropdownicon}
          onClick={() => setExpanded(!expanded)}
        />
      </div>
      <AnimatePresence>
        {expanded ? (
          <motion.div
            className={styles.cardBody}
            style={{ overflow: "hidden" }}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            {Array.from({ length: quantity }).map((_, i) => (
              <div key={i} draggable onDragStart={(e) => handleDragStart(e, 1)}>
                <span>{part?.name}</span>
                <span className={styles.cardBodyQuantity}>1</span>
              </div>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
