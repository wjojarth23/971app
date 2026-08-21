"use client";
import React, { createContext, useContext, useMemo, useState } from "react";
import type { Team } from "@/app/types";

type TabEvents = {
  updateCount: number;
  notifyUpdate: () => void;
  teams: Team[];
  setTeams: (teams: Team[]) => void;
};

const Ctx = createContext<TabEvents | null>(null);

export function TabEventsProvider({ children }: { children: React.ReactNode }) {
  const [updateCount, setUpdateCount] = useState(0);
  const [teams, setTeams] = useState<Team[]>([]);

  const value = useMemo(
    () => ({
      updateCount,
      notifyUpdate: () => setUpdateCount((c) => c + 1),
      teams,
      setTeams,
    }),
    [updateCount, teams]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTabEvents() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTabEvents must be used inside TabEventsProvider");
  return v;
}
