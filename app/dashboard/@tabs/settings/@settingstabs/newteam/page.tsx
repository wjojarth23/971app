"use client";

import styles from "./newteam.module.css";
import CollaboratorsSettingsPage from "../teams/[teamid]/Collaborators/Collaborators";
import type { Collaborator } from "@/app/types";
import { PrimaryButton } from "@/components/Buttons/Buttons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTabEvents } from "../../teamUpdate";
import { isTRPCClientError } from "@trpc/client";
import trpcClient from '@/lib/trpc/client';

export default function NewteamSettingsPage() {
  const [teamName, setTeamName] = useState("");
  const router = useRouter();
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const { notifyUpdate } = useTabEvents();
  async function handleCreateTeam(e: React.FormEvent) {
    e.preventDefault();
    try {
      const id = await trpcClient.teams.create.mutate({ name: teamName });
      // Send invites to all collaborators
      for (const collaborator of collaborators) {
        try {
          await fetch(`/api/teams/${id}/invites`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: collaborator.email,
              admin: collaborator.role === "Admin",
            }),
          });
        } catch (err) {
          console.error("Failed to send invite to:", collaborator.email, err);
        }
      }

      notifyUpdate();
      router.push("/dashboard/settings/teams/" + id);
    } catch (err) {
      if (isTRPCClientError(err))
        console.error("Error creating team:", err.cause);
    }
  }
  return (
    <div className={styles.newteamContainer}>
      <h1>New Team</h1>
      <hr />
      <div className={styles.teamNameSection}>
        <label>Team Name</label>
        <input
          type="text"
          placeholder="Enter team name"
          value={teamName}
          onChange={(e) => setTeamName(e.target.value)}
          className={styles.teamNameInput}
          required
        />
      </div>
      <br />
      <CollaboratorsSettingsPage
        optional
        collaborators={collaborators}
        setCollaborators={setCollaborators}
      />
      <br />
      <PrimaryButton onClick={(e) => handleCreateTeam(e)}>
        <span className="textGradient">Create Team</span>
      </PrimaryButton>
    </div>
  );
}
