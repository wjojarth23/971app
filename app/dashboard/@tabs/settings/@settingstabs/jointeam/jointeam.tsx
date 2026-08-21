"use client";

import styles from "./jointeam.module.css";
import { TeamInvite } from "@/app/types";
import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTabEvents } from "../../teamUpdate";
import { useDashboardEvents } from "@/app/dashboard/dashboardTeam";
import trpcClient from '@/lib/trpc/client';

export default function JoinTeamSettingsPage() {
  const [invites, setInvites] = useState<TeamInvite[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInvites = useCallback(async () => {
    try {
      const response = await fetch("/api/user/invites");
      if (response.ok) {
        const data = await response.json();
        // Map the API response to match the TeamInvite type
        const mappedInvites: TeamInvite[] = data.map(
          (invite: { id: string; team: string }) => ({
            id: invite.id,
            teamName: invite.team,
          })
        );
        setInvites(mappedInvites);
      }
    } catch (error) {
      console.error("Error fetching invites:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  if (loading) {
    return (
      <div className={styles.jointeamContainer}>
        <h1>Join Team</h1>
        <hr />
        <p>Loading invites...</p>
      </div>
    );
  }

  return (
    <div className={styles.jointeamContainer}>
      <h1>Join Team</h1>
      <hr />
      {invites.length === 0 ? (
        <p className={styles.noInvites}>No pending invites</p>
      ) : (
        invites.map((invite) => (
          <JoinCard key={invite.id} invite={invite} setInvites={setInvites} />
        ))
      )}
    </div>
  );
}

function JoinCard({
  invite,
  setInvites,
}: {
  invite: TeamInvite;
  setInvites: React.Dispatch<React.SetStateAction<TeamInvite[]>>;
}) {
  const { notifyUpdate, setTeams } = useTabEvents();
  const { triggerTeamsRefresh } = useDashboardEvents();
  const router = useRouter();
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = async () => {
    setIsJoining(true);
    try {
      // Call the accept endpoint via fetch to get the team_id
      const response = await fetch(`/api/user/invites/accept/${invite.id}`, {
        headers: {
          "Accept": "application/json",
        },
      });

      if (response.ok) {
        const { team_id } = await response.json();

        // Remove the invite from the local list
        setInvites((prev) => prev.filter((i) => i.id !== invite.id));

        // Reload the teams list
        try {
          const teamsData = await trpcClient.teams.get.query();
          teamsData.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
          setTeams(teamsData);

          // Trigger refresh for dashboard team dropdown
          triggerTeamsRefresh();

          notifyUpdate();
          router.push(`/dashboard/settings/teams/${team_id}`);
        } catch {}
      } else {
        console.error("Failed to accept invite");
        setIsJoining(false);
      }
    } catch (error) {
      console.error("Error accepting invite:", error);
      setIsJoining(false);
    }
  };

  const handleDecline = () => {
    // Note: There's no API endpoint to decline invites, so we just remove from UI
    // The invite will remain in the database until it's accepted or cancelled by the team admin
    setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    notifyUpdate();
  };

  return (
    <div className={styles.joinCard}>
      <span>{invite.teamName}</span>
      <button
        className={styles.joinButton}
        onClick={handleJoin}
        disabled={isJoining}
      >
        <Image
          src="/settings/join/Join.svg"
          alt="Join Team"
          className={styles.joinImage}
          width={2000}
          height={2000}
        />
      </button>
      <button className={styles.declineButton} onClick={handleDecline}>
        <Image
          src="/settings/join/Decline.svg"
          alt="Decline Invite"
          className={styles.declineImage}
          width={2000}
          height={2000}
        />
      </button>
    </div>
  );
}
