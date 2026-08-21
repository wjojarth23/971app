"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import styles from "../../partstoplates.module.css";
import { ModalPortal } from "./ModalPortal";

type ArrangeErrorModalProps = {
  open: boolean;
  message: string | null;
  retryBusy: boolean;
  onClose: () => void;
  onRetry: () => void;
};

export function ArrangeErrorModal({
  open,
  message,
  retryBusy,
  onClose,
  onRetry,
}: ArrangeErrorModalProps) {
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
                <span>Too Many Parts</span>
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
                    Some parts did not fit on this plate.
                  </div>
                  <div style={{ color: "var(--muted)" }}>
                    {message ??
                      "They were moved to Unassigned. Adjust the plate and retry."}
                  </div>
                </div>
              </div>
              <div className={styles.camModalFooter}>
                <button
                  type="button"
                  className={styles.camModalCancel}
                  onClick={onClose}
                  disabled={retryBusy}
                >
                  Close
                </button>
                <button
                  type="button"
                  className={styles.camModalConfirm}
                  onClick={onRetry}
                  disabled={retryBusy}
                >
                  {retryBusy ? "Retrying…" : "Retry Arrange"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
