import styles from "./partstoplates.module.css";
import { useMaterialEvents } from "../materialEvents";
import { PartsToPlatesCard } from "./components/PartsToPlatesCard";
import { classNames } from "./components/helpers";

export function PartsToPlates({
  categoryId,
  platesLoading = false,
  sectionId,
}: {
  categoryId: number;
  platesLoading?: boolean;
  sectionId?: string;
}) {
  const { plates } = useMaterialEvents();
  const showSkeleton = platesLoading && plates.length === 0;
  const skeletonCards = Array.from({ length: 2 });

  return (
    <div className={styles.container} id={sectionId}>
      <div className={styles.cardsContainer}>
        {showSkeleton
          ? skeletonCards.map((_, index) => (
              <div key={`plate-skeleton-${index}`} className={styles.cardWrapper}>
                <div className={styles.cardPlate}>
                  <div
                    className={classNames(
                      styles.skeletonBlock,
                      styles.plateSkeletonTitle
                    )}
                  />
                  <div
                    className={classNames(
                      styles.skeletonBlock,
                      styles.plateSkeletonMeta
                    )}
                  />
                  <div className={styles.partsSkeletonList}>
                    <div
                      className={classNames(
                        styles.skeletonBlock,
                        styles.partSkeletonRow
                      )}
                    />
                    <div
                      className={classNames(
                        styles.skeletonBlock,
                        styles.partSkeletonRow,
                        styles.partSkeletonRowShort
                      )}
                    />
                    <div
                      className={classNames(
                        styles.skeletonBlock,
                        styles.partSkeletonRow
                      )}
                    />
                  </div>
                  <div
                    className={classNames(
                      styles.skeletonBlock,
                      styles.arrangeSkeletonButton
                    )}
                  />
                </div>
                <div className={styles.jobsContainer}>
                  <div className={classNames(styles.jobCard, styles.jobCardSkeleton)}>
                    <span
                      className={classNames(styles.skeletonBlock, styles.skeletonId)}
                    />
                    <div
                      className={classNames(
                        styles.jobStatus,
                        styles.jobStatusSkeleton
                      )}
                    >
                      <span
                        className={classNames(
                          styles.skeletonBlock,
                          styles.skeletonLabel
                        )}
                      />
                      <span
                        className={classNames(
                          styles.skeletonBlock,
                          styles.skeletonDot
                        )}
                      />
                      <span
                        className={classNames(
                          styles.skeletonBlock,
                          styles.skeletonLabelWide
                        )}
                      />
                      <span
                        className={classNames(
                          styles.skeletonBlock,
                          styles.skeletonDot
                        )}
                      />
                      <span
                        className={classNames(
                          styles.skeletonBlock,
                          styles.skeletonLabel
                        )}
                      />
                      <span
                        className={classNames(
                          styles.skeletonBlock,
                          styles.skeletonDot
                        )}
                      />
                      <span
                        className={classNames(
                          styles.skeletonBlock,
                          styles.skeletonLabelWide
                        )}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))
          : Object.entries(plates).map(([name]) => (
              <PartsToPlatesCard key={name} name={name} categoryId={categoryId} />
            ))}
      </div>
    </div>
  );
}
