"use client";

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import styles from "./FileUploadModal.module.css";
import { PrimaryButton } from "@/components/Buttons/Buttons";

interface FileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, file: File) => void;
  title: string;
  acceptedFileType: string; // e.g., ".cps" or ".json"
  fileTypeLabel: string; // e.g., "CPS" or "JSON"
}

export default function FileUploadModal({
  isOpen,
  onClose,
  onSubmit,
  title,
  acceptedFileType,
  fileTypeLabel,
}: FileUploadModalProps) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const validateFile = useCallback(
    (file: File): boolean => {
      const extension = file.name
        .toLowerCase()
        .slice(file.name.lastIndexOf("."));
      if (extension !== acceptedFileType.toLowerCase()) {
        setError(`Please upload a ${fileTypeLabel} file (${acceptedFileType})`);
        return false;
      }
      setError(null);
      return true;
    },
    [acceptedFileType, fileTypeLabel]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && validateFile(droppedFile)) {
        setFile(droppedFile);
      }
    },
    [validateFile]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile && validateFile(selectedFile)) {
        setFile(selectedFile);
      }
    },
    [validateFile]
  );

  const handleSubmit = useCallback(() => {
    if (!name.trim()) {
      setError("Please enter a name");
      return;
    }
    if (!file) {
      setError("Please upload a file");
      return;
    }
    onSubmit(name.trim(), file);
    // Reset state
    setName("");
    setFile(null);
    setError(null);
    onClose();
  }, [name, file, onSubmit, onClose]);

  const handleClose = useCallback(() => {
    setName("");
    setFile(null);
    setError(null);
    onClose();
  }, [onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className={styles.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            className={styles.modal}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.header}>
              <h2>{title}</h2>
              <button
                type="button"
                className={styles.closeButton}
                onClick={handleClose}
              >
                <Image
                  src="/settings/teams/X.svg"
                  alt="Close"
                  className={styles.icon}
                  width={16}
                  height={16}
                />
              </button>
            </div>

            <div className={styles.content}>
              <div className={styles.inputGroup}>
                <label>Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter name..."
                  className={styles.textInput}
                />
              </div>

              <div className={styles.inputGroup}>
                <label>File ({fileTypeLabel})</label>
                <div
                  className={`${styles.dropZone} ${
                    isDragging ? styles.dragging : ""
                  } ${file ? styles.hasFile : ""}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={acceptedFileType}
                    onChange={handleFileSelect}
                    className={styles.hiddenInput}
                  />
                  {file ? (
                    <div className={styles.fileInfo}>
                      <Image
                        src="/settings/teams/File.svg"
                        alt="File"
                        width={24}
                        height={24}
                        className={styles.fileIcon + " " + styles.icon}
                      />
                      <span className={styles.fileName}>{file.name}</span>
                      <button
                        type="button"
                        className={styles.removeFile}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFile(null);
                        }}
                      >
                        <Image
                          src="/settings/teams/X.svg"
                          alt="Remove"
                          width={14}
                          height={14}
                        />
                      </button>
                    </div>
                  ) : (
                    <div className={styles.dropZoneContent}>
                      <Image
                        src="/settings/teams/Upload.svg"
                        alt="Upload"
                        width={32}
                        height={32}
                        className={styles.uploadIcon + " " + styles.icon}
                      />
                      <p>
                        Drag & drop your {fileTypeLabel} file here
                        <br />
                        <span>or click to browse</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {error && <p className={styles.error}>{error}</p>}
            </div>

            <div className={styles.footer}>
              <button
                type="button"
                className={styles.cancelButton}
                onClick={handleClose}
              >
                Cancel
              </button>
              <PrimaryButton type="button" onClick={handleSubmit}>
                <span className="textGradient">Add {title.split(" ")[1]}</span>
              </PrimaryButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
