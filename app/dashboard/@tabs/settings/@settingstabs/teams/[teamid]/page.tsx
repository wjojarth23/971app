"use client";

import styles from "./team.module.css";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PrimaryButton } from "@/components/Buttons/Buttons";
import FusionInputs from "./FusionInputs/FusionInputs";
import CollaboratorsSettingsPage from "./Collaborators/Collaborators";
import { useTabEvents } from "../../../../settings/teamUpdate";
import { useParams, useRouter } from "next/navigation";
import ApiKeys from "./ApiKeys/ApiKeys";
import FusionServer from "./FusionServer/FusionServer";
import { authClient } from "@/lib/auth/client";

const sectionDelayStep = 0.15;
const sectionEase = [0.25, 0.46, 0.45, 0.94] as const;

export function TeamName({
  oldTeamName,
  rename = true,
  handleFormSubmit,
}: {
  oldTeamName: string;
  rename?: boolean;
  handleFormSubmit: (teamName: string) => void;
}) {
  const [teamName, setTeamName] = useState(oldTeamName);
  return (
    <form
      className={styles.teamNameForm}
      onSubmit={(e) => {
        e.preventDefault();
        handleFormSubmit(teamName);
      }}
    >
      <label className={styles.sectionLabel}>Team Name</label>
      <div id={styles.teamNameContainer}>
        <div id={styles.teamNameInputContainer}>
          <input
            type="text"
            placeholder="Add Team Name"
            value={teamName}
            min={3}
            onChange={(val) => setTeamName(val.target.value)}
          />
        </div>
        <PrimaryButton id={styles.teamNameButton}>
          <span className="textGradient">{rename ? "Rename" : "Save"}</span>
        </PrimaryButton>
      </div>
    </form>
  );
}

export default function TeamSettingsPage() {
  const router = useRouter();
  const [teamName, setTeamName] = useState<string>("");
  const { teamid } = useParams();
  const [teamDbId, setTeamDbId] = useState<number>(0);
  const { teams, notifyUpdate } = useTabEvents();
  const [isOwner, setIsOwner] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [emailVerified, setEmailVerified] = useState(true);
  const [adminCount, setAdminCount] = useState(0);
  const [otherMembers, setOtherMembers] = useState<
    { email: string; name: string; admin: boolean; isOwner: boolean }[]
  >([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [selectedNewOwner, setSelectedNewOwner] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  // Load current user session info
  useEffect(() => {
    async function loadSession() {
      const { data } = await authClient.getSession();
      if (data?.user?.id) {
        setCurrentUserEmail(data.user.email ?? null);
        setEmailVerified(data.user.emailVerified ?? false);
      }
    }
    loadSession();
  }, []);

  const routeTeamId = (() => {
    const idStr = Array.isArray(teamid) ? teamid[0] : teamid;
    const parsed = Number(idStr);
    return Number.isFinite(parsed) ? parsed : null;
  })();

  // Fetch members to check admin status
  useEffect(() => {
    if (!teamDbId || !currentUserEmail) return;
    async function fetchMembers() {
      try {
        const response = await fetch(`/api/teams/${teamDbId}/members`);
        if (response.ok) {
          const members: {
            email: string;
            name: string;
            admin: boolean;
            isOwner: boolean;
          }[] = await response.json();
          const admins = members.filter((m) => m.admin);
          setAdminCount(admins.length);

          const currentMember = members.find(
            (m) => m.email === currentUserEmail
          );
          setIsOwner(currentMember?.isOwner ?? false);
          // Owner is always treated as admin for settings access
          setIsAdmin(currentMember?.admin ?? currentMember?.isOwner ?? false);

          // Get other members (excluding current user) for ownership transfer
          setOtherMembers(members.filter((m) => m.email !== currentUserEmail));
        }
      } catch (err) {
        console.error("Error fetching members:", err);
      }
    }
    fetchMembers();
  }, [teamDbId, currentUserEmail]);

  useEffect(() => {
    // Wait for teams to load before checking access
    if (teams.length === 0) return;

    if (!routeTeamId) {
      router.push("/dashboard/settings/personal");
      return;
    }
    const team = teams.find((t) => t.id === routeTeamId);

    // If team doesn't exist, user doesn't have access - redirect
    if (!team) {
      router.push("/dashboard/settings/personal");
      return;
    }

    setTeamName(team.name);
    setTeamDbId(team.id);
  }, [teamid, teams, router]);

  const handleDeleteTeam = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/teams/${teamDbId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        notifyUpdate();
        router.push("/dashboard/settings/personal");
      } else {
        console.error("Failed to delete team:", await response.text());
      }
    } catch (err) {
      console.error("Error deleting team:", err);
    } finally {
      setIsDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const handleLeaveClick = () => {
    setLeaveError(null);

    // Check if owner needs to transfer ownership
    if (isOwner) {
      if (otherMembers.length === 0) {
        setLeaveError("You are the only member. Delete the team instead.");
        return;
      }
      setShowTransferModal(true);
      return;
    }

    // Check if sole admin trying to leave
    if (isAdmin && adminCount <= 1) {
      setLeaveError(
        "You are the only admin. Assign admin to someone else before leaving."
      );
      return;
    }

    setShowLeaveModal(true);
  };

  const handleLeaveTeam = async () => {
    if (!currentUserEmail) return;
    setIsLeaving(true);
    try {
      const response = await fetch(
        `/api/teams/${teamDbId}/members?email=${encodeURIComponent(currentUserEmail)}`,
        { method: "DELETE" }
      );
      if (response.ok) {
        notifyUpdate();
        router.push("/dashboard/settings/personal");
      } else {
        console.error("Failed to leave team:", await response.text());
      }
    } catch (err) {
      console.error("Error leaving team:", err);
    } finally {
      setIsLeaving(false);
      setShowLeaveModal(false);
    }
  };

  const handleTransferAndLeave = async () => {
    if (!currentUserEmail || !selectedNewOwner) return;
    setIsLeaving(true);
    try {
      // If owner is sole admin and new owner is not admin, make them admin first
      const newOwnerMember = otherMembers.find(
        (m) => m.email === selectedNewOwner
      );
      if (
        isAdmin &&
        adminCount <= 1 &&
        newOwnerMember &&
        !newOwnerMember.admin
      ) {
        // Make new owner an admin
        const adminResponse = await fetch(`/api/teams/${teamDbId}/members`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: selectedNewOwner, admin: true }),
        });
        if (!adminResponse.ok) {
          console.error(
            "Failed to make new owner admin:",
            await adminResponse.text()
          );
          setIsLeaving(false);
          return;
        }
      }

      // Transfer ownership
      const transferResponse = await fetch(`/api/teams/${teamDbId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner: selectedNewOwner }),
      });
      if (!transferResponse.ok) {
        console.error(
          "Failed to transfer ownership:",
          await transferResponse.text()
        );
        setIsLeaving(false);
        return;
      }

      // Now leave the team
      const leaveResponse = await fetch(
        `/api/teams/${teamDbId}/members?email=${encodeURIComponent(currentUserEmail)}`,
        { method: "DELETE" }
      );
      if (leaveResponse.ok) {
        notifyUpdate();
        router.push("/dashboard/settings/personal");
      } else {
        console.error("Failed to leave team:", await leaveResponse.text());
      }
    } catch (err) {
      console.error("Error transferring and leaving:", err);
    } finally {
      setIsLeaving(false);
      setShowTransferModal(false);
      setSelectedNewOwner(null);
    }
  };

  let sectionIndex = 0;
  const getNextSectionMotion = () => {
    const transition = {
      delay: sectionIndex * sectionDelayStep,
      duration: 0.5,
      ease: sectionEase,
    };
    sectionIndex += 1;
    return {
      initial: { opacity: 0, y: 20 },
      animate: { opacity: 1, y: 0 },
      transition,
    };
  };

  return (
    <motion.div
      className={styles.teamPage}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.5,
        ease: [0.25, 0.46, 0.45, 0.94]
      }}
    >
      <div className={styles.teamContainer}>
        <motion.div {...getNextSectionMotion()}>
          <h1 className={styles.teamTitle}>{teamName}</h1>
          <hr className={styles.teamDivider} />
        </motion.div>
        {isAdmin && emailVerified && teamName ? (
          <motion.div {...getNextSectionMotion()}>
            <TeamName
              oldTeamName={teamName}
              handleFormSubmit={async (newName) => {
                const response = await fetch("/api/teams/" + teamDbId, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ name: newName }),
                });
                if (response.ok) {
                  setTeamName(newName);
                  notifyUpdate();
                } else {
                  console.error("Error renaming team:", await response.text());
                }
              }}
            />
          </motion.div>
        ) : null}
        <br />
        <motion.div {...getNextSectionMotion()}>
          <CollaboratorsSettingsPage
            teamDbId={teamDbId}
            readOnly={!isAdmin || !emailVerified}
          />
        </motion.div>
        <br />
        {isAdmin && emailVerified && (
          <motion.div {...getNextSectionMotion()}>
            <FusionInputs
              teamId={teamDbId}
            />
          </motion.div>
        )}
      </div>
      {isAdmin && emailVerified && (
        <>
          <motion.div {...getNextSectionMotion()}>
            <br />
            <ApiKeys />
          </motion.div>
          <motion.div {...getNextSectionMotion()}>
            <br />
            <FusionServer />
          </motion.div>
        </>
      )}

      <motion.div className={styles.teamActions} {...getNextSectionMotion()}>
        <motion.button
          className={styles.leaveTeamButton}
          onClick={handleLeaveClick}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Leave Team
        </motion.button>
        {isOwner && (
          <motion.button
            className={styles.deleteTeamButton}
            onClick={() => setShowDeleteModal(true)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Delete Team
          </motion.button>
        )}
      </motion.div>
      {leaveError && <p className={styles.leaveError}>{leaveError}</p>}

      {showLeaveModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.leaveModal}>
            <h3>Leave Team?</h3>
            <p>
              Are you sure you want to leave <strong>{teamName}</strong>? You
              will lose access to all team resources.
            </p>
            <div className={styles.modalButtons}>
              <button
                className={styles.cancelButton}
                onClick={() => setShowLeaveModal(false)}
                disabled={isLeaving}
              >
                Cancel
              </button>
              <button
                className={styles.confirmLeaveButton}
                onClick={handleLeaveTeam}
                disabled={isLeaving}
              >
                {isLeaving ? "Leaving..." : "Leave Team"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransferModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.transferModal}>
            <h3>Transfer Ownership</h3>
            <p>
              As the owner, you must transfer ownership before leaving.
              {isAdmin && adminCount <= 1 && (
                <>
                  <br />
                  <br />
                  You are also the only admin. The new owner will be made an
                  admin.
                </>
              )}
            </p>
            <label className={styles.transferLabel}>Select new owner:</label>
            <select
              className={styles.transferSelect}
              value={selectedNewOwner || ""}
              onChange={(e) => setSelectedNewOwner(e.target.value || null)}
            >
              <option value="">Choose a member...</option>
              {otherMembers.map((member) => (
                <option key={member.email} value={member.email}>
                  {member.name} {member.admin ? "(Admin)" : "(Member)"}
                </option>
              ))}
            </select>
            <div className={styles.modalButtons}>
              <button
                className={styles.cancelButton}
                onClick={() => {
                  setShowTransferModal(false);
                  setSelectedNewOwner(null);
                }}
                disabled={isLeaving}
              >
                Cancel
              </button>
              <button
                className={styles.confirmTransferButton}
                onClick={handleTransferAndLeave}
                disabled={isLeaving || !selectedNewOwner}
              >
                {isLeaving ? "Transferring..." : "Transfer & Leave"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.deleteModal}>
            <h3>Delete Team?</h3>
            <p>
              This action is <strong>permanent</strong> and cannot be undone.
              All team data, including materials, machines, API keys, and
              members will be deleted.
            </p>
            <div className={styles.modalButtons}>
              <button
                className={styles.cancelButton}
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                className={styles.confirmDeleteButton}
                onClick={handleDeleteTeam}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Delete Team"}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
