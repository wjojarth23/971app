"use client";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Team } from "@/app/types";
import { authClient } from "@/lib/auth/client";

type TabEvents = {
  team: Team | null;
  setTeam: React.Dispatch<React.SetStateAction<Team | null>>;
  emailVerified: boolean;
  isLoadingAuth: boolean;
  userId: string | null;
  userEmail: string | null;
  sessionExpiresAt: string | null;
  teamsRefreshCount: number;
  triggerTeamsRefresh: () => void;
  draftCount: number;
  notifyDraftCountChange: () => void;
};

const Ctx = createContext<TabEvents | null>(null);

export function DashboardEventsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [team, setTeam] = useState<Team | null>(null);
  const [emailVerified, setEmailVerified] = useState(true); // Default to true to avoid flash
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);
  const [teamsRefreshCount, setTeamsRefreshCount] = useState(0);
  const [draftCount, setDraftCount] = useState(0);
  const [draftCountRefresh, setDraftCountRefresh] = useState(0);

  useEffect(() => {
    async function checkEmailVerification() {
      try {
        const { data } = await authClient.getSession();
        if (data?.user) {
          setEmailVerified(data.user.emailVerified ?? false);
          setUserId(data.user.id ?? null);
          setUserEmail(data.user.email ?? null);
          const expiresAt = (data as unknown as { session?: { expiresAt?: unknown } })
            ?.session?.expiresAt;
          if (expiresAt instanceof Date) setSessionExpiresAt(expiresAt.toISOString());
          else if (typeof expiresAt === "string") setSessionExpiresAt(expiresAt);
          else if (typeof expiresAt === "number") setSessionExpiresAt(new Date(expiresAt).toISOString());
          else setSessionExpiresAt(null);
        } else {
          setUserId(null);
          setUserEmail(null);
          setSessionExpiresAt(null);
        }
      } catch (err) {
        console.error("Error checking email verification:", err);
      } finally {
        setIsLoadingAuth(false);
      }
    }
    checkEmailVerification();
  }, []);

  // Fetch draft count when team changes or when notified
  useEffect(() => {
    if (!team) {
      setDraftCount(0);
      return;
    }

    const teamId = team.id;
    let mounted = true;

    async function fetchDraftCount() {
      try {
        const res = await fetch(`/api/teams/${teamId}/drafts/count`);
        if (res.ok && mounted) {
          const data = await res.json();
          setDraftCount(data.count ?? 0);
        }
      } catch (err) {
        console.error("Failed to fetch draft count:", err);
      }
    }

    fetchDraftCount();

    // Refresh periodically
    const interval = setInterval(fetchDraftCount, 30000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [team, draftCountRefresh]);

  const value = useMemo(
    () => ({
      team,
      setTeam,
      emailVerified,
      isLoadingAuth,
      userId,
      userEmail,
      sessionExpiresAt,
      teamsRefreshCount,
      triggerTeamsRefresh: () => setTeamsRefreshCount((c) => c + 1),
      draftCount,
      notifyDraftCountChange: () => setDraftCountRefresh((c) => c + 1),
    }),
    [team, emailVerified, isLoadingAuth, userId, userEmail, sessionExpiresAt, teamsRefreshCount, draftCount]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDashboardEvents() {
  const v = useContext(Ctx);
  if (!v)
    throw new Error(
      "useDashboardEvents must be used inside DashboardEventsProvider"
    );
  return v;
}
