"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import styles from "../../partstoplates.module.css";
import { ModalPortal } from "./ModalPortal";

type CamErrorModalProps = {
  open: boolean;
  title: string;
  message: string | null;
  machineName: string | null;
  retryBusy: boolean;
  onClose: () => void;
  onRetry: () => void;
};

export function CamErrorModal({
  open,
  title,
  message,
  machineName,
  retryBusy,
  onClose,
  onRetry,
}: CamErrorModalProps) {
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
                <span>{title}</span>
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
                <div className={styles.camModalPlaceholder}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>
                    This CAM job finished with an error.
                  </div>
                  <div style={{ color: "var(--muted)" }}>
                    {message ?? "No additional details provided."}
                  </div>
                  {machineName ? (
                    <div
                      style={{
                        color: "var(--muted)",
                        marginTop: 8,
                        fontSize: 13,
                      }}
                    >
                      Machine: {machineName}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={styles.camModalFooter}>
                <button
                  type="button"
                  className={styles.camModalCancel}
                  onClick={onClose}
                >
                  Close
                </button>
                <button
                  type="button"
                  className={styles.camModalConfirm}
                  onClick={onRetry}
                  disabled={retryBusy}
                >
                  {retryBusy ? "Retrying…" : "Retry CAM"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
