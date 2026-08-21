import Image from "next/image";
import styles from "../partstoplates.module.css";
import { PartsCard } from "./PartsCard";

type PlatePartsSectionProps = {
  plateId: number | null | undefined;
  plateIndex: number;
  parts: { partId: number; quantity: number }[];
  onDeletePlate: (plateId: number) => void;
  onArrange: () => void;
  arrangeLoading?: boolean;
  loading?: boolean;
  onReceive: (data: { partId: number; quantity: number; from?: number }) => void;
  trueDepthValue: string;
  trueDepthStatus: "idle" | "saving" | "saved" | "error";
  onTrueDepthChange: (value: string) => void;
};

export function PlatePartsSection({
  plateId,
  plateIndex,
  parts,
  onDeletePlate,
  onArrange,
  arrangeLoading,
  loading,
  onReceive,
  trueDepthValue,
  trueDepthStatus,
  onTrueDepthChange,
}: PlatePartsSectionProps) {
  const trueDepthStatusText =
    trueDepthStatus === "saving"
      ? "Saving..."
      : trueDepthStatus === "saved"
      ? "Auto Saved"
      : trueDepthStatus === "error"
      ? "Save failed"
      : "";
  const visibleParts = parts.filter((part) => part.quantity > 0);

  return (
    <div
      className={styles.cardPlate}
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
      <div id={styles.plateName}>Plate {plateIndex + 1}</div>
      {plateId != null ? (
        <div className={styles.plateMetaRow}>
          <span className={styles.plateMetaLabel}>True Depth</span>
          <input
            type="number"
            min="0"
            step="0.001"
            className={styles.plateMetaInput}
            value={trueDepthValue}
            onChange={(e) => onTrueDepthChange(e.target.value)}
          />
          {trueDepthStatusText ? (
            <span
              className={`${styles.plateMetaStatus} ${
                trueDepthStatus === "saved"
                  ? styles.plateMetaStatusSaved
                  : trueDepthStatus === "error"
                  ? styles.plateMetaStatusError
                  : ""
              }`}
            >
              {trueDepthStatusText}
            </span>
          ) : null}
        </div>
      ) : null}
      {plateId != null ? (
        <button
          type="button"
          className={styles.plateDeleteButton}
          onClick={() => onDeletePlate(plateId)}
          aria-label="Delete plate"
        >
          <Image
            src="/dashboard/delete.svg"
            alt="Delete plate"
            width={14}
            height={14}
            className={styles.plateDeleteIcon}
          />
        </button>
      ) : null}
      {plateId != null ? (
        loading ? (
          <div className={styles.partsSkeletonList} aria-hidden>
            <div
              className={`${styles.skeletonBlock} ${styles.partSkeletonRow}`}
            />
            <div
              className={`${styles.skeletonBlock} ${styles.partSkeletonRow} ${styles.partSkeletonRowShort}`}
            />
            <div
              className={`${styles.skeletonBlock} ${styles.partSkeletonRow}`}
            />
          </div>
        ) : visibleParts.length > 0 ? (
          visibleParts.map((part, index) => (
            <PartsCard
              key={`${part.partId}-${index}`}
              partId={part.partId}
              quantity={part.quantity}
              plateId={plateId}
            />
          ))
        ) : (
          <div className={styles.emptyPlatePlaceholder}>Drag parts here</div>
        )
      ) : null}
      <button
        className={styles.arrangeButton}
        onClick={onArrange}
        disabled={Boolean(arrangeLoading)}
      >
        <span>Arrange</span>
        <Image
          src="/mat_thickness/Arrange.svg"
          alt="Arrange"
          width={2000}
          height={2000}
          className={styles.arrangeIcon}
        />
      </button>
    </div>
  );
}
