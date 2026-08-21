"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import styles from "../../partstoplates.module.css";
import { ModalPortal } from "./ModalPortal";

type PlateDeleteConfirmModalProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export function PlateDeleteConfirmModal({
  open,
  busy,
  onClose,
  onConfirm,
}: PlateDeleteConfirmModalProps) {
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
                <span>Delete Plate?</span>
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
                    Remove this plate from the category?
                  </div>
                  <div style={{ color: "var(--muted)" }}>
                    This deletes the plate and its assignments. You can recreate
                    it later if needed.
                  </div>
                </div>
              </div>
              <div className={styles.camModalFooter}>
                <button
                  type="button"
                  className={styles.camModalCancel}
                  onClick={onClose}
                  disabled={busy}
                >
                  Keep Plate
                </button>
                <button
                  type="button"
                  className={styles.camModalConfirm}
                  onClick={onConfirm}
                  disabled={busy}
                >
                  {busy ? "Deleting…" : "Delete Plate"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ModalPortal>
  );
}
