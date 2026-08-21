"use client";

import styles from "./collaborators.module.css";
import { PrimaryButton } from "@/components/Buttons/Buttons";
import { useEffect, useRef, useState, FormEvent, useCallback } from "react";
import { Collaborator } from "@/app/types";
import Image from "next/image";
import { authClient } from "@/lib/auth/client";
import { Alert } from "@/app/signup/page";

interface CollaboratorsProps {
  optional?: boolean;
  teamDbId?: number;
  readOnly?: boolean;
  // For new team flow - local state management
  collaborators?: Collaborator[];
  setCollaborators?: React.Dispatch<React.SetStateAction<Collaborator[]>>;
}

export default function CollaboratorsSettingsPage({
  optional = false,
  teamDbId,
  readOnly = false,
  collaborators: externalCollaborators,
  setCollaborators: setExternalCollaborators,
}: CollaboratorsProps) {
  // Use external state if provided (new team flow), otherwise internal state
  const useLocalState = !teamDbId || teamDbId === 0;
  const [internalCollaborators, setInternalCollaborators] = useState<
    Collaborator[]
  >([]);

  const collaborators = useLocalState
    ? externalCollaborators ?? internalCollaborators
    : internalCollaborators;

  const setCollaborators = useLocalState
    ? setExternalCollaborators ?? setInternalCollaborators
    : setInternalCollaborators;

  const [isLoading, setIsLoading] = useState(!useLocalState);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const alertTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    collaborator: Collaborator | null;
    newRole: "Admin" | "Member" | null;
  }>({ open: false, collaborator: null, newRole: null });

  // Fetch current user's email
  useEffect(() => {
    async function loadCurrentUser() {
      const { data } = await authClient.getSession();
      if (data?.user?.email) {
        setCurrentUserEmail(data.user.email);
      }
    }
    loadCurrentUser();
  }, []);

  // Auto-dismiss alert after 4 seconds
  useEffect(() => {
    if (alertMessage) {
      if (alertTimeoutRef.current) {
        clearTimeout(alertTimeoutRef.current);
      }
      alertTimeoutRef.current = setTimeout(() => {
        setAlertMessage(null);
      }, 4000);
    }
    return () => {
      if (alertTimeoutRef.current) {
        clearTimeout(alertTimeoutRef.current);
      }
    };
  }, [alertMessage]);

  // Count number of users with admin privileges (Admins + Owners)
  // Owners have admin privileges, so they count toward maintaining admin coverage
  const adminPrivilegedCount = collaborators.filter(
    (c) => c.role === "Admin" || c.role === "Owner"
  ).length;

  // Fetch members and invites from API (only for existing teams)
  const fetchCollaborators = useCallback(async () => {
    if (!teamDbId || teamDbId === 0) return;

    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch(`/api/teams/${teamDbId}/members`),
        fetch(`/api/teams/${teamDbId}/invites`),
      ]);

      if (!membersRes.ok || !invitesRes.ok) {
        console.error("Failed to fetch collaborators");
        return;
      }

      const members: {
        email: string;
        name: string;
        admin: boolean;
        isOwner: boolean;
      }[] = await membersRes.json();
      const invites: { email: string; admin: boolean }[] =
        await invitesRes.json();

      const collaboratorsList: Collaborator[] = [
        ...members.map((m, idx) => ({
          id: idx + 1,
          email: m.email,
          name: m.name,
          role: (m.isOwner ? "Owner" : m.admin ? "Admin" : "Member") as
            | "Owner"
            | "Admin"
            | "Member",
        })),
        ...invites.map((inv, idx) => ({
          id: members.length + idx + 1,
          email: inv.email,
          name: inv.email.split("@")[0] || "Unknown",
          role: "pending" as const,
        })),
      ];

      setInternalCollaborators(collaboratorsList);
    } catch (err) {
      console.error("Error fetching collaborators:", err);
    } finally {
      setIsLoading(false);
    }
  }, [teamDbId]);

  useEffect(() => {
    if (!useLocalState && teamDbId) {
      fetchCollaborators();
    }
  }, [teamDbId, fetchCollaborators, useLocalState]);

  async function handleAddCollaborator(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const form = e.currentTarget;
    const formData = new FormData(form);
    const email = (formData.get("email") as string) || "";

    if (!email) return;

    // For new team flow, just add to local state
    if (useLocalState) {
      setCollaborators((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          email,
          name: email.split("@")[0] || "Unknown",
          role: "pending",
        },
      ]);
      form.reset();
      return;
    }

    // For existing teams, call the API
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/teams/${teamDbId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, admin: false }),
      });

      if (!response.ok) {
        const text = await response.text();
        if (response.status === 404) {
          setError("No user found with this email address");
        } else if (response.status === 409) {
          setError("An invite has already been sent to this email");
        } else {
          setError(text || "Failed to send invite");
        }
        return;
      }

      // Add to local state as pending
      setCollaborators((prev) => [
        ...prev,
        {
          id: prev.length + 1,
          email,
          name: email.split("@")[0] || "Unknown",
          role: "pending",
        },
      ]);

      form.reset();
    } catch (err) {
      console.error("Error sending invite:", err);
      setError("An error occurred while sending the invite");
    } finally {
      setIsSending(false);
    }
  }

  async function handleRoleChange(
    collaborator: Collaborator,
    newRole: "Admin" | "Member",
    confirmed: boolean = false
  ) {
    // Clear any previous alert
    setAlertMessage(null);

    if (collaborator.role === newRole) {
      return;
    }

    // Check if this would remove the last user with admin privileges
    // (Only block if demoting an Admin AND there are no other Admins or Owners left)
    if (
      collaborator.role === "Admin" &&
      newRole === "Member" &&
      adminPrivilegedCount <= 1
    ) {
      setAlertMessage("There must be at least one admin or owner in the team");
      return;
    }

    // Confirm role changes for all collaborators.
    if (!confirmed) {
      setConfirmModal({ open: true, collaborator, newRole });
      return;
    }

    // For new team flow, just update local state
    if (useLocalState) {
      setCollaborators((prev) =>
        prev.map((c) =>
          c.id === collaborator.id ? { ...c, role: newRole } : c
        )
      );
      return;
    }

    if (collaborator.role === "pending") return;

    try {
    const response = await fetch(`/api/teams/${teamDbId}/members`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: collaborator.email,
        admin: newRole === "Admin",
      }),
    });

      if (!response.ok) {
        console.error("Failed to update role:", await response.text());
        setAlertMessage("Failed to update role");
        return;
      }

      setCollaborators((prev) =>
        prev.map((c) =>
          c.id === collaborator.id ? { ...c, role: newRole } : c
        )
      );
    } catch (err) {
      console.error("Error updating role:", err);
      setAlertMessage("An error occurred while updating the role");
    }
  }

  function handleConfirmRoleChange() {
    if (confirmModal.collaborator && confirmModal.newRole) {
      handleRoleChange(confirmModal.collaborator, confirmModal.newRole, true);
    }
    setConfirmModal({ open: false, collaborator: null, newRole: null });
  }

  function handleCancelRoleChange() {
    setConfirmModal({ open: false, collaborator: null, newRole: null });
  }

  async function handleRemove(collaborator: Collaborator) {
    // Clear any previous alert
    setAlertMessage(null);

    // Check if this would remove the last user with admin privileges
    // (Only block if removing an Admin AND there are no other Admins or Owners left)
    if (collaborator.role === "Admin" && adminPrivilegedCount <= 1) {
      setAlertMessage("There must be at least one admin or owner in the team");
      return;
    }

    // For new team flow, just remove from local state
    if (useLocalState) {
      setCollaborators((prev) => prev.filter((c) => c.id !== collaborator.id));
      return;
    }

    try {
      const isPending = collaborator.role === "pending";
      const endpoint = isPending
        ? `/api/teams/${teamDbId}/invites`
        : `/api/teams/${teamDbId}/members`;

      const response = await fetch(
        `${endpoint}?email=${encodeURIComponent(collaborator.email)}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        console.error("Failed to remove collaborator:", await response.text());
        setAlertMessage("Failed to remove collaborator");
        return;
      }

      setCollaborators((prev) => prev.filter((c) => c.id !== collaborator.id));
    } catch (err) {
      console.error("Error removing collaborator:", err);
      setAlertMessage("An error occurred while removing the collaborator");
    }
  }

  if (isLoading) {
    return (
      <div className={styles.collaboratorsContainer}>
        <h1>
          Collaborators{" "}
          <span className={styles.optional}>
            {optional ? "(Optional)" : null}
          </span>
        </h1>
        <div className={styles.collaboratorsList}>
          <div className={styles.loadingContainer}>
            <span className={styles.loadingSpinner} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={styles.collaboratorsContainer}>
        <h1>
          Collaborators{" "}
          <span className={styles.optional}>
            {optional ? "(Optional)" : null}
          </span>
        </h1>
        {!readOnly && (
          <form onSubmit={handleAddCollaborator}>
            <div className={styles.addCollaboratorSection}>
              <div className={styles.addCollaboratorContainer}>
                <Image
                  alt="search"
                  src="/settings/teams/search.svg"
                  width={2000}
                  height={2000}
                  className={styles.searchIcon}
                />
                <input
                  type="email"
                  name="email"
                  placeholder="Enter email"
                  autoComplete="off"
                  data-lpignore="true"
                  data-form-type="other"
                />
              </div>
              <PrimaryButton type="submit" disabled={isSending}>
                <span className="textGradient">
                  {isSending ? "Sending..." : "Add Collaborator"}
                </span>
              </PrimaryButton>
            </div>
            {error && <p className={styles.error}>{error}</p>}
          </form>
        )}
        {!readOnly && (
          <div className={styles.alertWrapper}>
            <Alert message={alertMessage || ""} open={!!alertMessage} />
          </div>
        )}
        <div className={styles.collaboratorsList}>
          {collaborators.map((collaborator) => (
            <CollaboratorCard
              collaborator={collaborator}
              key={collaborator.id}
              onRoleChange={handleRoleChange}
              onRemove={handleRemove}
              readOnly={readOnly}
              isCurrentUser={collaborator.email === currentUserEmail}
            />
          ))}
          {collaborators.length === 0 && (
            <div className={styles.emptyStateContainer}>
              <span className={styles.emptyState}>
                {readOnly
                  ? "No collaborators."
                  : "Enter an email to add a collaborator."}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModal.open && (
        <div className={styles.confirmModalOverlay}>
          <div className={styles.confirmModal}>
            <h3>Change Role?</h3>
            <p>
              Are you sure you want to change{" "}
              <strong>
                {confirmModal.collaborator?.name ||
                  confirmModal.collaborator?.email}
              </strong>{" "}
              from{" "}
              <strong>{confirmModal.collaborator?.role}</strong> to{" "}
              <strong>{confirmModal.newRole}</strong>?
              {confirmModal.collaborator?.email === currentUserEmail &&
                confirmModal.newRole === "Member" && (
                  <> You will lose admin privileges.</>
                )}
            </p>
            <div className={styles.confirmModalButtons}>
              <button
                className={styles.cancelButton}
                onClick={handleCancelRoleChange}
              >
                Cancel
              </button>
              <button
                className={styles.confirmButton}
                onClick={handleConfirmRoleChange}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function CollaboratorCard({
  collaborator,
  onRoleChange,
  onRemove,
  readOnly = false,
  isCurrentUser = false,
}: {
  collaborator: Collaborator;
  onRoleChange: (
    collaborator: Collaborator,
    newRole: "Admin" | "Member",
    confirmed?: boolean
  ) => void;
  onRemove: (collaborator: Collaborator) => void;
  readOnly?: boolean;
  isCurrentUser?: boolean;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }

    // Only add listener when dropdown is open to avoid unnecessary listeners
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownOpen]);

  function handleRoleChange(newRole: "Admin" | "Member") {
    onRoleChange(collaborator, newRole);
    setDropdownOpen(false);
  }

  // Determine if role dropdown should be shown
  // Don't show for: pending, Owner, or readOnly mode
  const showRoleDropdown =
    !readOnly &&
    collaborator.role !== "pending" &&
    collaborator.role !== "Owner";

  // Determine if remove button should be shown
  // Don't show for: Owner, readOnly
  const canRemove = !readOnly && collaborator.role !== "Owner";

  return (
    <div className={styles.collaboratorCard}>
      <div className={styles.name}>
        {collaborator.name}
        {isCurrentUser && <span className={styles.youBadge}>(You)</span>}
      </div>
      <div className={styles.role}>
        {showRoleDropdown ? (
          <button onClick={() => setDropdownOpen(!dropdownOpen)}>
            {collaborator.role}
            <Image
              alt="dropdown"
              src="/settings/teams/collabDropdown.svg"
              width={2000}
              height={2000}
              className={styles.dropdownIcon}
            />
          </button>
        ) : (
          <span>{collaborator.role}</span>
        )}
        {dropdownOpen && (
          <div className={styles.roleDropdown} ref={dropdownRef}>
            <div
              className={styles.roleOption}
              onClick={() => handleRoleChange("Admin")}
            >
              Admin
            </div>
            <div
              className={styles.roleOption}
              onClick={() => handleRoleChange("Member")}
            >
              Member
            </div>
          </div>
        )}
      </div>
      {canRemove && (
        <Image
          alt="remove"
          src="/settings/teams/remove.svg"
          width={2000}
          height={2000}
          className={styles.removeIcon}
          onClick={() => onRemove(collaborator)}
        />
      )}
    </div>
  );
}
