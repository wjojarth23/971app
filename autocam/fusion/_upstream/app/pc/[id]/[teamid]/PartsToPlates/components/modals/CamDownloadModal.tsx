"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import styles from "../../partstoplates.module.css";
import { ModalPortal } from "./ModalPortal";

type CamDownloadModalProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  arrangePreviewUrl: string | null;
  arrangePreviewType: "image" | "pdf" | "other" | null;
  camBundleUrl: string | null;
  machineName: string | null;
  machiningTime: string | null;
  onClose: () => void;
  onOpenDeleteConfirm: () => void;
};

export function CamDownloadModal({
  open,
  loading,
  error,
  arrangePreviewUrl,
  arrangePreviewType,
  camBundleUrl,
  machineName,
  machiningTime,
  onClose,
  onOpenDeleteConfirm,
}: CamDownloadModalProps) {
  return (
    <ModalPortal>
      <AnimatePresence>
        {open && (
          <motion.div
            className={styles.camModalOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          >
            <motion.div
              className={styles.camModal}
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.camModalHeader}>
                <span>CAM Bundle Ready</span>
                <button
                  type="button"
                  className={styles.camModalClose}
                  onClick={onClose}
                >
                  <Image
                    src="/settings/teams/X.svg"
                    alt="Close"
                    width={16}
                    height={16}
                    style={{ filter: "invert(1)" }}
                  />
                </button>
              </div>
              <div className={styles.camModalBody}>
                <div className={styles.camModalControls}>
                  <label className={styles.camModalLabel}>Arrange Preview</label>
                  {loading ? (
                    <div className={styles.camModalPlaceholder}>Loading…</div>
                  ) : arrangePreviewUrl ? (
                    arrangePreviewType === "image" ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <img
                          src={arrangePreviewUrl}
                          alt="Arrangement screenshot"
                          className={styles.camModalImage}
                        />
                      </div>
                    ) : (
                      <div className={styles.camModalPlaceholder}>
                        <div>No preview available.</div>
                        <div
                          style={{
                            display: "flex",
                            gap: 10,
                            justifyContent: "center",
                            marginTop: 8,
                          }}
                        >
                          <a
                            href={arrangePreviewUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open
                          </a>
                          <a href={arrangePreviewUrl} download>
                            Download
                          </a>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className={styles.camModalPlaceholder}>
                      No arrange screenshot found.
                    </div>
                  )}
                  {error ? (
                    <div className={styles.camModalError}>{error}</div>
                  ) : null}
                </div>
              </div>
              <div className={styles.camModalFooter}>
                <div className={styles.camModalFooterLeft}>
                  {machineName ? <div>{`Machine: ${machineName}`}</div> : null}
                  {machiningTime ? (
                    <div>{`Machining time: ${machiningTime}`}</div>
                  ) : null}
                </div>
                <div className={styles.camModalFooterRight}>
                  <button
                    type="button"
                    className={styles.camModalCancel}
                    onClick={onClose}
                    disabled={loading}
                  >
                    Close
                  </button>
                  {camBundleUrl ? (
                    <a
                      href={camBundleUrl}
                      download
                      className={styles.camModalConfirm}
                      style={{ textAlign: "center" }}
                      onClick={onOpenDeleteConfirm}
                    >
                      Download CAM
                    </a>
                  ) : (
                    <button
                      type="button"
                      className={styles.camModalConfirm}
                      disabled
                    >
                      CAM Not Available
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
