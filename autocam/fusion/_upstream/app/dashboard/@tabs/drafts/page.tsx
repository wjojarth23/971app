"use client";

import { motion, AnimatePresence } from "framer-motion";
import styles from "./drafts.module.css";
import { useState, useEffect } from "react";
import { useDashboardEvents } from "@/app/dashboard/dashboardTeam";
import { PrimaryButton, SecondaryButton } from "@/components/Buttons/Buttons";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Draft, PendingCategory } from "@/app/types";

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function calculateCompleteness(draft: Draft): number {
  const requiredFields = ["name", "epic", "ticket", "quantity", "has_file"];
  if (draft.type === "part") {
    requiredFields.push("category");
  }

  let completed = 0;
  if (draft.name) completed++;
  if (draft.epic) completed++;
  if (draft.ticket) completed++;
  if (draft.quantity) completed++;
  if (draft.has_file) completed++;
  if (draft.type === "part" && (draft.category_id || draft.pending_category)) completed++;

  return Math.round((completed / requiredFields.length) * 100);
}

function getMissingFields(draft: Draft): string[] {
  const missing: string[] = [];
  if (!draft.name) missing.push("Name");
  if (!draft.epic) missing.push("Epic");
  if (!draft.ticket) missing.push("Ticket");
  if (!draft.quantity) missing.push("Quantity");
  if (!draft.has_file) missing.push("File");
  if (draft.type === "part" && !draft.category_id && !draft.pending_category) {
    missing.push("Category");
  }
  return missing;
}

function DraftCard({
  draft,
  delay,
  onResume,
  onDelete,
  isDeleting
}: {
  draft: Draft;
  delay: number;
  onResume: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const completeness = calculateCompleteness(draft);
  const missingFields = getMissingFields(draft);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ delay, duration: 0.3 }}
      className={styles.draftCard}
    >
      <div className={styles.cardHeader}>
        <span className={`${styles.draftType} ${draft.type === "part" ? styles.typePart : styles.typeBoxTube}`}>
          {draft.type === "part" ? "Part" : "Box Tube"}
        </span>
        <span className={styles.draftDate}>
          {formatRelativeTime(new Date(draft.updated_at))}
        </span>
      </div>

      <h3 className={styles.draftName}>
        {draft.name || "Untitled Draft"}
      </h3>

      <div className={styles.draftMeta}>
        {draft.epic && <span>Epic: {draft.epic}</span>}
        {draft.ticket && <span>Ticket: {draft.ticket}</span>}
        {draft.quantity && <span>Qty: {draft.quantity}</span>}
      </div>

      <div className={styles.progressContainer}>
        <div
          className={styles.progressBar}
          style={{ width: `${completeness}%` }}
        />
      </div>
      <span className={styles.progressText}>{completeness}% complete</span>

      {missingFields.length > 0 && (
        <div className={styles.missingFields}>
          <span className={styles.missingLabel}>Missing:</span>
          {missingFields.map((field) => (
            <span key={field} className={styles.missingTag}>{field}</span>
          ))}
        </div>
      )}

      <div className={styles.cardActions}>
        <SecondaryButton onClick={onResume} disabled={isDeleting}>
          <span className="textGradient">Resume</span>
        </SecondaryButton>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={onDelete}
          disabled={isDeleting}
        >
          <Image
            src="/dashboard/remove.svg"
            alt="Delete"
            width={16}
            height={16}
          />
        </button>
      </div>
    </motion.div>
  );
}

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
        <p>You need to be part of a team to view drafts.</p>
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

export default function DraftsPage() {
  const { team, notifyDraftCountChange } = useDashboardEvents();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!team) {
      setDrafts([]);
      setIsLoading(false);
      return;
    }

    const teamId = team.id;
    let mounted = true;

    async function loadDrafts() {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/teams/${teamId}/drafts`);
        if (res.ok && mounted) {
          setDrafts(await res.json());
        }
      } catch (err) {
        console.error("Failed to load drafts:", err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadDrafts();
    return () => { mounted = false; };
  }, [team]);

  async function handleDelete(draftId: number) {
    setDeletingIds(prev => new Set([...prev, draftId]));
    try {
      const res = await fetch(`/api/drafts/${draftId}`, { method: "DELETE" });
      if (res.ok) {
        setDrafts(prev => prev.filter(d => d.id !== draftId));
        notifyDraftCountChange?.();
      }
    } catch (err) {
      console.error("Failed to delete draft:", err);
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(draftId);
        return next;
      });
    }
  }

  function handleResume(draft: Draft) {
    router.push(`/dashboard/upload?draft=${draft.id}`);
  }

  if (!team && !isLoading) {
    return <NoTeamCard />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Drafts</h1>
        {drafts.length > 0 && (
          <span className={styles.count}>{drafts.length} draft{drafts.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {isLoading ? (
        <div className={styles.loadingContainer}>
          <span className={styles.loadingSpinner} />
        </div>
      ) : drafts.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No drafts yet</p>
          <PrimaryButton onClick={() => router.push("/dashboard/upload")}>
            <span className="textGradient">Start New Upload</span>
          </PrimaryButton>
        </div>
      ) : (
        <AnimatePresence mode="popLayout">
          <div className={styles.draftsList}>
            {drafts.map((draft, index) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                delay={index * 0.1}
                onResume={() => handleResume(draft)}
                onDelete={() => handleDelete(draft.id)}
                isDeleting={deletingIds.has(draft.id)}
              />
            ))}
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
