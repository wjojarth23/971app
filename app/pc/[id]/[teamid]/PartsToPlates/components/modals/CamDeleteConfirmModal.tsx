"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import styles from "../../partstoplates.module.css";
import { ModalPortal } from "./ModalPortal";

type CamDeleteConfirmModalProps = {
  open: boolean;
  busy: boolean;
  errorMessage: string | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function CamDeleteConfirmModal({
  open,
  busy,
  errorMessage,
  onClose,
  onConfirm,
}: CamDeleteConfirmModalProps) {
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
                <span>After Download</span>
                <button
                  type="button"
                  className={styles.camModalClose}
                  onClick={onClose}
                  disabled={busy}
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
                    Delete this plate’s CAM + arrange jobs?
                  </div>
                  <div style={{ color: "var(--muted)", marginBottom: 6 }}>
                    - Delete: removes both the CAM and its arrange job from the
                    queue/history for this plate. You can still re-run Arrange/CAM
                    later if needed.
                  </div>
                  <div style={{ color: "var(--muted)" }}>
                    - Keep: leaves the jobs visible so teammates can download
                    again.
                  </div>
                  {errorMessage ? (
                    <div
                      className={styles.camModalError}
                      style={{ marginTop: 8 }}
                    >
                      {errorMessage}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={styles.camModalFooter}>
                <button
                  type="button"
                  className={styles.camModalCancel}
                  onClick={onClose}
                  disabled={busy}
                >
                  Keep CAM Job
                </button>
                <button
                  type="button"
                  className={styles.camModalConfirm}
                  onClick={onConfirm}
                  disabled={busy}
                >
                  {busy ? "Deleting…" : "Delete CAM Job"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
