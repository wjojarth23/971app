import Image from "next/image";
import type { PlatesJob } from "@/app/types";
import styles from "../partstoplates.module.css";
import {
  PlateJobRun,
  buildPlateJobRuns,
  classNames,
  MotionPath,
} from "./helpers";

export type PlatesJobWithMeta = PlatesJob & {
  payload?: unknown;
  response?: unknown;
};

type PlateJobsListProps = {
  currentPlateId: number | null | undefined;
  jobs: PlatesJob[];
  jobsDeleteError: string | null;
  jobsDeleteBusy: Record<number, boolean>;
  loading: boolean;
  arrangeLoading: boolean;
  onDeleteRun: (run: PlateJobRun) => void;
  onOpenArrangeError: (
    message: string | null,
    plateId: number | null,
    arrangeId: number | null
  ) => void;
  onOpenCamModal: (plateId: number, arrangeId: number) => void;
  onOpenCamError: (
    message: string | null,
    plateId: number | null,
    arrangeId: number | null,
    camId: number | null,
    machineName: string | null
  ) => void;
  onOpenCamDownload: (arrangeId: number, camId: number, plateId: number) => void;
  getArrangeErrorMessage: (job?: PlatesJobWithMeta) => string | null;
  getArrangeExcessParts: (
    job?: PlatesJobWithMeta
  ) => { part_id: number; quantity: number }[];
  getArrangeOversizedParts: (
    job?: PlatesJobWithMeta
  ) => { part_id: number; quantity: number }[];
  getJobError: (job?: PlatesJobWithMeta) => string | null;
  getCamMachineLabel: (job?: PlatesJobWithMeta) => string | null;
};

export function PlateJobsList({
  currentPlateId,
  jobs,
  jobsDeleteError,
  jobsDeleteBusy,
  loading,
  arrangeLoading,
  onDeleteRun,
  onOpenArrangeError,
  onOpenCamModal,
  onOpenCamError,
  onOpenCamDownload,
  getArrangeErrorMessage,
  getArrangeExcessParts,
  getArrangeOversizedParts,
  getJobError,
  getCamMachineLabel,
}: PlateJobsListProps) {
  const queueTitle = (position: number) =>
    position > 0 ? `Queue position: ${position}` : undefined;

  const showSkeleton = loading || arrangeLoading;

  return (
    <div className={styles.jobsContainer} aria-busy={showSkeleton}>
      {jobsDeleteError ? (
        <div className={styles.jobsError}>{jobsDeleteError}</div>
      ) : null}
      {showSkeleton ? (
        <div className={classNames(styles.jobCard, styles.jobCardSkeleton)}>
          <span className={classNames(styles.skeletonBlock, styles.skeletonId)} />
          <div className={classNames(styles.jobStatus, styles.jobStatusSkeleton)}>
            <span
              className={classNames(styles.skeletonBlock, styles.skeletonLabel)}
            />
            <span
              className={classNames(styles.skeletonBlock, styles.skeletonDot)}
            />
            <span
              className={classNames(
                styles.skeletonBlock,
                styles.skeletonLabelWide
              )}
            />
            <span
              className={classNames(styles.skeletonBlock, styles.skeletonDot)}
            />
            <span
              className={classNames(styles.skeletonBlock, styles.skeletonLabel)}
            />
            <span
              className={classNames(styles.skeletonBlock, styles.skeletonDot)}
            />
            <span
              className={classNames(
                styles.skeletonBlock,
                styles.skeletonLabelWide
              )}
            />
          </div>
        </div>
      ) : null}
      {buildPlateJobRuns(jobs).map((run, index) => {
        const arrange = run.arrange;
        const cam = run.cam;
        const arrangeQueued = arrange.status === "pending";
        const arrangeInProgress = arrange.status === "in progress";
        const arrangeCompleted = arrange.status === "completed";
        const camQueued = cam?.status === "pending";
        const camInProgress = cam?.status === "in progress";
        const camCompleted = cam?.status === "completed";
        const arrangeErrorText = arrangeCompleted
          ? getArrangeErrorMessage(arrange as PlatesJobWithMeta)
          : null;
        const arrangeExcessParts = arrangeCompleted
          ? getArrangeExcessParts(arrange as PlatesJobWithMeta)
          : [];
        const arrangeOversizedParts = arrangeCompleted
          ? getArrangeOversizedParts(arrange as PlatesJobWithMeta)
          : [];
        const hasArrangeError =
          (arrangeCompleted && arrangeExcessParts.length > 0) ||
          (arrangeCompleted && arrangeOversizedParts.length > 0) ||
          (arrangeCompleted && Boolean(arrangeErrorText));
        const camErrorText =
          camCompleted && cam ? getJobError(cam as PlatesJobWithMeta) : null;
        const camHasError = camCompleted && Boolean(camErrorText);
        const camMachineLabel =
          camCompleted && cam ? getCamMachineLabel(cam as PlatesJobWithMeta) : null;
        const readyForCam = arrangeCompleted && !hasArrangeError && !cam;
        const readyForCamDownload = camCompleted && !camHasError;
        const arrangeClickable = readyForCam || hasArrangeError;

        return (
          <div key={arrange.id} className={styles.jobCard}>
            <span className={styles.jobId}>Job {index + 1}</span>
            <div className={styles.jobStatus}>
              <span
                className={classNames(
                  styles.statusLabel,
                  styles.queued,
                  arrangeQueued && styles.tooltipTarget,
                  arrangeQueued && styles.stageQueued,
                  arrangeQueued && styles.noBorder,
                  arrangeCompleted && !hasArrangeError && styles.stageComplete
                )}
                data-tooltip={arrangeQueued ? queueTitle(arrange.queue_position) ?? "" : ""}
              >
                Queue
                {arrangeQueued ? <MotionPath /> : null}
              </span>
              <span
                className={classNames(
                  styles.statusDot,
                  arrangeCompleted && !hasArrangeError && styles.dotComplete
                )}
              />
              <span
                className={classNames(
                  styles.statusLabel,
                  styles.largetext,
                  arrangeInProgress && styles.stageQueued,
                  arrangeInProgress && styles.noBorder,
                  arrangeCompleted && !hasArrangeError && styles.stageComplete,
                  hasArrangeError && styles.stageError,
                  readyForCam && styles.stageAction,
                  arrangeClickable && styles.clickable
                )}
                role={arrangeClickable ? "button" : undefined}
                tabIndex={arrangeClickable ? 0 : undefined}
                onClick={() => {
                  if (hasArrangeError) {
                    onOpenArrangeError(
                      arrangeErrorText,
                      currentPlateId ?? null,
                      arrange.id
                    );
                    return;
                  }
                  if (!readyForCam || currentPlateId == null) return;
                  onOpenCamModal(currentPlateId, arrange.id);
                }}
                onKeyDown={(e) => {
                  if (!arrangeClickable) return;
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  if (hasArrangeError) {
                    onOpenArrangeError(
                      arrangeErrorText,
                      currentPlateId ?? null,
                      arrange.id
                    );
                    return;
                  }
                  if (!readyForCam || currentPlateId == null) return;
                  onOpenCamModal(currentPlateId, arrange.id);
                }}
              >
                {arrangeInProgress ? "Arranging" : "Arrange"}
                {arrangeInProgress ? <MotionPath /> : null}
              </span>
              <span
                className={classNames(
                  styles.statusDot,
                  arrangeCompleted && !hasArrangeError && styles.dotComplete
                )}
              />
              <span
                className={classNames(
                  styles.statusLabel,
                  styles.queued,
                  camQueued && styles.tooltipTarget,
                  camQueued && styles.stageQueued,
                  camQueued && styles.noBorder,
                  cam && styles.stageComplete
                )}
                data-tooltip={camQueued ? queueTitle(cam.queue_position) ?? "" : ""}
              >
                Queue
                {camQueued ? <MotionPath /> : null}
              </span>
              <span
                className={classNames(styles.statusDot, cam && styles.dotComplete)}
              />
              <span
                className={classNames(
                  styles.statusLabel,
                  styles.largetext,
                  camQueued && styles.tooltipTarget,
                  camInProgress && styles.stageInProgress,
                  !camHasError && camCompleted && styles.stageComplete,
                  camHasError && styles.stageError,
                  readyForCamDownload && styles.stageAction,
                  (readyForCamDownload || camHasError) && styles.clickable
                )}
                data-tooltip={
                  camHasError
                    ? camErrorText ?? "Job completed with an error."
                    : camQueued
                    ? queueTitle(cam.queue_position) ?? ""
                    : camMachineLabel
                    ? `Machine: ${camMachineLabel}`
                    : ""
                }
                role={readyForCamDownload || camHasError ? "button" : undefined}
                tabIndex={readyForCamDownload || camHasError ? 0 : undefined}
                onClick={() => {
                  if (!cam) return;
                  if (camHasError) {
                    onOpenCamError(
                      camErrorText,
                      currentPlateId ?? null,
                      arrange.id,
                      cam.id,
                      camMachineLabel
                    );
                    return;
                  }
                  if (readyForCamDownload && currentPlateId != null) {
                    onOpenCamDownload(arrange.id, cam.id, currentPlateId);
                  }
                }}
                onKeyDown={(e) => {
                  if (!cam) return;
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  if (camHasError) {
                    onOpenCamError(
                      camErrorText,
                      currentPlateId ?? null,
                      arrange.id,
                      cam.id,
                      camMachineLabel
                    );
                    return;
                  }
                  if (readyForCamDownload && currentPlateId != null) {
                    onOpenCamDownload(arrange.id, cam.id, currentPlateId);
                  }
                }}
              >
                CAM
                {camMachineLabel && (
                  <span className={styles.machineHint}>{camMachineLabel}</span>
                )}
                {camInProgress && !camHasError ? <MotionPath /> : null}
              </span>
            </div>
            <div className={styles.trashContainer}>
              <button
                type="button"
                className={styles.trashButton}
                onClick={() => onDeleteRun(run)}
                disabled={Boolean(
                  jobsDeleteBusy[arrange.id] || (cam && jobsDeleteBusy[cam.id])
                )}
                aria-label="Delete job"
                title="Delete job"
              >
                <Image
                  src={"/mat_thickness/trash.svg"}
                  alt=""
                  width={2000}
                  height={2000}
                  className={styles.trashIcon}
                />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
