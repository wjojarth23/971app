"use client";

import { motion, AnimatePresence } from "framer-motion";
import styles from "./upload.module.css";
import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import { useDashboardEvents } from "@/app/dashboard/dashboardTeam";
import { PrimaryButton, SecondaryButton } from "@/components/Buttons/Buttons";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { PartCategory, Material, Draft, PendingCategory } from "@/app/types";

type UploadTab = "part" | "box_tube";

const STEP_FILE_ERROR = "Only STEP (.step, .stp) files are supported";
const STEP_FILE_REGEX = /\.st(ep|p)$/i;

function NoTeamCard() {
  const router = useRouter();
  return (
    <div className={styles.noTeamContainer}>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className={styles.noTeamCard}
      >
        <h2>No Team Found</h2>
        <p>You need to be part of a team to upload parts.</p>
        <div className={styles.noTeamButtons}>
          <PrimaryButton
            onClick={() => router.push("/dashboard/settings/newteam")}
          >
            <span className="textGradient">Create a Team</span>
          </PrimaryButton>
          <SecondaryButton
            onClick={() => router.push("/dashboard/settings/jointeam")}
          >
            <span className="textGradient">Join a Team</span>
          </SecondaryButton>
        </div>
      </motion.div>
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

function generateTicketId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AUTO-${timestamp}-${random}`;
}

function UploadPageContent() {
  const { team, notifyDraftCountChange } = useDashboardEvents();
  const router = useRouter();
  const searchParams = useSearchParams();
  const draftIdParam = searchParams.get("draft");

  const [activeTab, setActiveTab] = useState<UploadTab>("part");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name, setName] = useState("");
  const [epic, setEpic] = useState("");
  const [ticket, setTicket] = useState("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [file, setFile] = useState<File | null>(null);
  const [existingFileName, setExistingFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // Part-specific state
  const [categories, setCategories] = useState<PartCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newMaterial, setNewMaterial] = useState("");
  const [newThickness, setNewThickness] = useState<number | "">("");
  const [materials, setMaterials] = useState<Material[]>([]);

  // Draft tracking
  const [currentDraftId, setCurrentDraftId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track initial state for dirty checking
  const [initialState, setInitialState] = useState<string>("");

  const isStepFile = useCallback((selectedFile: File) => {
    return STEP_FILE_REGEX.test(selectedFile.name);
  }, []);

  const ensureTicket = useCallback(() => {
    if (ticket) return ticket;
    const generated = generateTicketId();
    setTicket(generated);
    return generated;
  }, [ticket]);

  type DraftOverrides = Partial<{
    name: string | null;
    epic: string | null;
    ticket: string | null;
    quantity: number | "" | null;
    category_id: number | null;
    pending_category: PendingCategory | null;
    type: UploadTab;
  }>;

  const getDraftState = useCallback((overrides: DraftOverrides = {}) => {
    const resolvedName =
      "name" in overrides ? overrides.name : name;
    const resolvedEpic =
      "epic" in overrides ? overrides.epic : epic;
    const resolvedTicket =
      "ticket" in overrides ? overrides.ticket : ticket;
    const resolvedQuantity =
      "quantity" in overrides ? overrides.quantity : quantity;
    const resolvedCategoryId =
      "category_id" in overrides ? overrides.category_id : selectedCategoryId;
    const resolvedType =
      "type" in overrides ? overrides.type : activeTab;
    const resolvedPendingCategory =
      "pending_category" in overrides
        ? overrides.pending_category
        : showNewCategory && newMaterial && newThickness
          ? { material: newMaterial, thickness: Number(newThickness) }
          : null;

    return {
      name: resolvedName || null,
      epic: resolvedEpic || null,
      ticket: resolvedTicket || null,
      quantity:
        resolvedQuantity === "" || resolvedQuantity === null || resolvedQuantity === undefined
          ? null
          : Number(resolvedQuantity),
      category_id: resolvedCategoryId ?? null,
      pending_category: resolvedPendingCategory,
      type: resolvedType,
    };
  }, [
    name,
    epic,
    ticket,
    quantity,
    selectedCategoryId,
    showNewCategory,
    newMaterial,
    newThickness,
    activeTab,
  ]);

  // Load categories and materials on team change
  useEffect(() => {
    if (!team) return;
    const teamId = team.id;
    let mounted = true;

    async function loadData() {
      try {
        const [pcRes, matRes] = await Promise.all([
          fetch(`/api/teams/${teamId}/pc`),
          fetch(`/api/teams/${teamId}/materials`)
        ]);

        if (mounted) {
          if (pcRes.ok) setCategories(await pcRes.json());
          if (matRes.ok) setMaterials(await matRes.json());
        }
      } catch (err) {
        console.error("Failed to load categories/materials:", err);
      }
    }

    loadData();
    return () => { mounted = false; };
  }, [team]);

  // Load existing draft if draft ID is in URL
  useEffect(() => {
    if (!draftIdParam || !team) return;

    const draftId = parseInt(draftIdParam, 10);
    if (isNaN(draftId)) return;

    setIsLoading(true);

    async function loadDraft() {
      try {
        const res = await fetch(`/api/drafts/${draftId}`);
        if (res.ok) {
          const draft: Draft = await res.json();
          setCurrentDraftId(draft.id);
          setActiveTab(draft.type);
          setName(draft.name ?? "");
          setEpic(draft.epic ?? "");
          setTicket(draft.ticket ?? "");
          setQuantity(draft.quantity ?? "");
          setSelectedCategoryId(draft.category_id ?? null);
          if (draft.pending_category) {
            setShowNewCategory(true);
            setNewMaterial(draft.pending_category.material);
            setNewThickness(draft.pending_category.thickness);
          }
          if (draft.has_file && draft.file_name) {
            setExistingFileName(draft.file_name);
          }
          setLastSaved(new Date(draft.updated_at));
          setInitialState(JSON.stringify({
            name: draft.name, epic: draft.epic, ticket: draft.ticket,
            quantity: draft.quantity, category_id: draft.category_id,
            pending_category: draft.pending_category, type: draft.type
          }));
        }
      } catch (err) {
        console.error("Failed to load draft:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadDraft();
  }, [draftIdParam, team]);

  const getCurrentState = useCallback(
    () => JSON.stringify(getDraftState()),
    [getDraftState]
  );

  const hasUnsavedChanges = useCallback(() => {
    if (!currentDraftId && !name && !epic && !ticket && !quantity && !file) return false;
    return getCurrentState() !== initialState || file !== null;
  }, [currentDraftId, name, epic, ticket, quantity, file, getCurrentState, initialState]);

  // Auto-save draft when form changes
  useEffect(() => {
    if (!team || !hasUnsavedChanges()) return;

    const timeout = setTimeout(() => {
      saveDraft();
    }, 2000);

    return () => clearTimeout(timeout);
  }, [name, epic, ticket, quantity, selectedCategoryId, newMaterial, newThickness, activeTab]);

  // Warn on navigation if unsaved
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  async function saveDraft(overrides: DraftOverrides = {}) {
    if (!team) return;
    const teamId = team.id;
    setIsSaving(true);
    setError(null);

    try {
      const draftState = getDraftState(overrides);
      const draftData = {
        type: draftState.type,
        name: draftState.name ?? undefined,
        epic: draftState.epic ?? undefined,
        ticket: draftState.ticket ?? undefined,
        quantity: draftState.quantity ?? undefined,
        category_id: draftState.category_id ?? undefined,
        pending_category: draftState.pending_category ?? undefined
      };

      if (currentDraftId) {
        // PATCH existing draft metadata
        const res = await fetch(`/api/drafts/${currentDraftId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draftData)
        });

        if (!res.ok) {
          throw new Error("Failed to save draft");
        }

        // If there's a new file, upload it separately
        if (file) {
          const fileFormData = new FormData();
          fileFormData.append("file", file);

          const fileRes = await fetch(`/api/drafts/${currentDraftId}/file`, {
            method: "PATCH",
            body: fileFormData
          });

          if (fileRes.ok) {
            setExistingFileName(file.name);
            setFile(null);
            setFileError(null);
          }
        }
      } else {
        // POST new draft
        const formData = new FormData();
        formData.append("data", JSON.stringify(draftData));
        if (file) {
          formData.append("file", file);
        }

        const res = await fetch(`/api/teams/${teamId}/drafts`, {
          method: "POST",
          body: formData
        });

        if (!res.ok) {
          throw new Error("Failed to create draft");
        }

        const data = await res.json();
        setCurrentDraftId(data.id);
        if (file) {
          setExistingFileName(file.name);
          setFile(null);
          setFileError(null);
        }
        notifyDraftCountChange?.();
      }

      setLastSaved(new Date());
      setInitialState(JSON.stringify(draftState));
    } catch (err) {
      console.error("Failed to save draft:", err);
      setError("Failed to save draft");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit() {
    setError(null);
    const ensuredTicket = ensureTicket();

    // Validate required fields
    if (!name || !epic || !quantity) {
      setError("Please fill in all required fields");
      return;
    }

    if (!file && !existingFileName) {
      setError("Please upload a STEP (.step, .stp) file");
      setFileError(STEP_FILE_ERROR);
      return;
    }

    if (existingFileName && !STEP_FILE_REGEX.test(existingFileName) && !file) {
      setError(STEP_FILE_ERROR);
      setFileError(STEP_FILE_ERROR);
      return;
    }

    if (activeTab === "part" && !selectedCategoryId && !(showNewCategory && newMaterial && newThickness)) {
      setError("Please select or create a category");
      return;
    }

    setIsSubmitting(true);

    try {
      // Save draft first if needed
      if (!currentDraftId || hasUnsavedChanges()) {
        await saveDraft({ ticket: ensuredTicket });
      }

      // Wait a moment for the draft to be saved
      await new Promise(resolve => setTimeout(resolve, 100));

      // Finalize draft
      const res = await fetch(`/api/drafts/${currentDraftId}/finalize`, {
        method: "POST"
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to finalize upload");
      }

      const result = await res.json();
      notifyDraftCountChange?.();

      // Reset form and redirect
      resetForm();

      if (result.type === "part") {
        router.push("/dashboard/plates");
      } else {
        router.push("/dashboard/boxtubes");
      }
    } catch (err) {
      console.error("Failed to submit:", err);
      setError(err instanceof Error ? err.message : "Failed to upload");
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetForm() {
    setName("");
    setEpic("");
    setTicket("");
    setQuantity("");
    setFile(null);
    setExistingFileName(null);
    setFileError(null);
    setSelectedCategoryId(null);
    setShowNewCategory(false);
    setNewMaterial("");
    setNewThickness("");
    setCurrentDraftId(null);
    setLastSaved(null);
    setInitialState("");
    setError(null);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const droppedFile = files[0];
      if (!isStepFile(droppedFile)) {
        setFileError(STEP_FILE_ERROR);
        return;
      }
      setFileError(null);
      ensureTicket();
      setFile(droppedFile);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files && files.length > 0) {
      const selectedFile = files[0];
      if (!isStepFile(selectedFile)) {
        setFileError(STEP_FILE_ERROR);
        e.target.value = "";
        return;
      }
      setFileError(null);
      ensureTicket();
      setFile(selectedFile);
    }
  }

  if (!team && !isLoading) {
    return <NoTeamCard />;
  }

  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <span className={styles.loadingSpinner} />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Upload</h1>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${activeTab === "part" ? styles.active : ""}`}
            onClick={() => setActiveTab("part")}
            type="button"
          >
            Part
          </button>
          <button
            className={`${styles.tab} ${activeTab === "box_tube" ? styles.active : ""}`}
            onClick={() => setActiveTab("box_tube")}
            type="button"
          >
            Box Tube
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className={styles.formContainer}
        >
          {error && (
            <div className={styles.errorBanner}>{error}</div>
          )}

          <div className={styles.inputGroup}>
            <label>Name <span className={styles.required}>*</span></label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Enter name"
            />
          </div>

          <div className={styles.row}>
            <div className={styles.inputGroup}>
              <label>Epic <span className={styles.required}>*</span></label>
              <input
                type="text"
                value={epic}
                onChange={e => setEpic(e.target.value)}
                placeholder="Enter epic"
              />
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label>Quantity <span className={styles.required}>*</span></label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={e => setQuantity(e.target.value ? Number(e.target.value) : "")}
              placeholder="Enter quantity"
            />
          </div>

          {activeTab === "part" && (
            <div className={styles.categorySection}>
              <label>Category <span className={styles.required}>*</span></label>
              {!showNewCategory ? (
                <div className={styles.categorySelector}>
                  <select
                    value={selectedCategoryId ?? ""}
                    onChange={e => setSelectedCategoryId(Number(e.target.value) || null)}
                  >
                    <option value="">Select a category...</option>
                    {categories.map(cat => (
                      <option key={cat.id} value={cat.id}>
                        {cat.material} - {cat.thickness}&quot;
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={styles.newCategoryButton}
                    onClick={() => {
                      setShowNewCategory(true);
                      setSelectedCategoryId(null);
                    }}
                  >
                    + New
                  </button>
                </div>
              ) : (
                <div className={styles.newCategoryForm}>
                  <select
                    value={newMaterial}
                    onChange={e => setNewMaterial(e.target.value)}
                  >
                    <option value="">Select material...</option>
                    {materials.map(m => (
                      <option key={m.id} value={m.name}>{m.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step="0.001"
                    min="0"
                    placeholder="Thickness"
                    value={newThickness}
                    onChange={e => setNewThickness(e.target.value ? Number(e.target.value) : "")}
                  />
                  <button
                    type="button"
                    className={styles.cancelButton}
                    onClick={() => {
                      setShowNewCategory(false);
                      setNewMaterial("");
                      setNewThickness("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          <div className={styles.fileSection}>
            <label>File <span className={styles.required}>*</span></label>
            <div
              className={`${styles.dropZone} ${isDragging ? styles.dragging : ""} ${file || existingFileName ? styles.hasFile : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              {file || existingFileName ? (
                <div className={styles.fileInfo}>
                  <span className={styles.fileName}>{file?.name ?? existingFileName}</span>
                  <button
                    type="button"
                    className={styles.removeFile}
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                      setExistingFileName(null);
                      setFileError(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className={styles.dropZoneContent}>
                  <Image
                    src="/dashboard/Sidebar/Upload.svg"
                    alt="Upload"
                    width={32}
                    height={32}
                    className={styles.uploadIcon}
                  />
                  <p>Drag &amp; drop your file here or click to browse</p>
                  <span className={styles.fileTypes}>STEP files only (.step, .stp)</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".step,.stp"
                onChange={handleFileSelect}
                hidden
              />
            </div>
            {fileError && (
              <span className={styles.fileError}>{fileError}</span>
            )}
          </div>

          <div className={styles.saveStatus}>
            {isSaving ? (
              <span className={styles.saving}>Saving draft...</span>
            ) : lastSaved ? (
              <span className={styles.saved}>Draft saved {formatRelativeTime(lastSaved)}</span>
            ) : null}
          </div>

          <div className={styles.actions}>
            <SecondaryButton onClick={() => saveDraft()} disabled={isSaving}>
              <span className="textGradient">Save as Draft</span>
            </SecondaryButton>
            <PrimaryButton onClick={handleSubmit} disabled={isSubmitting}>
              <span className="textGradient">
                {isSubmitting ? "Uploading..." : "Upload"}
              </span>
            </PrimaryButton>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={
      <div className={styles.loadingContainer}>
        <span className={styles.loadingSpinner} />
      </div>
    }>
      <UploadPageContent />
    </Suspense>
  );
}
