"use client";
import React, { createContext, useContext, useMemo, useState, useEffect } from "react";
import type { Plate, Part } from "@/app/types";

interface PartsToPlates {
  [key: number]: {
    partId: number;
    quantity: number;
  }[];
}
type materialEvents = {
  plates: Plate[];
  setPlates: React.Dispatch<React.SetStateAction<Plate[]>>;
  selectedParts: { [key: number]: number };
  setSelectedParts: React.Dispatch<
    React.SetStateAction<{ [key: number]: number }>
  >;
  parts: Part[];
  setParts: React.Dispatch<React.SetStateAction<Part[]>>;
  partsToPlates: PartsToPlates;
  setPartsToPlates: React.Dispatch<React.SetStateAction<PartsToPlates>>;
  unassignedParts: { [key: number]: number };
  setUnassignedParts: React.Dispatch<
    React.SetStateAction<{ [key: number]: number }>
  >;
};

const Ctx = createContext<materialEvents | null>(null);

export function MaterialEventsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [plates, setPlates] = useState<Plate[]>([]);
  const [selectedParts, setSelectedParts] = useState<{ [key: number]: number }>(
    {}
  );
  const [parts, setParts] = useState<Part[]>([]);
  const [partsToPlates, setPartsToPlates] = useState<PartsToPlates>({});
  const [unassignedParts, setUnassignedParts] = useState<{
    [key: number]: number;
  }>({});

  useEffect(() => {
    if (parts.length === 0) return;
    const assignedTotals = new Map<number, number>();
    for (const assignments of Object.values(partsToPlates)) {
      if (!Array.isArray(assignments)) continue;
      for (const assignment of assignments) {
        assignedTotals.set(
          assignment.partId,
          (assignedTotals.get(assignment.partId) ?? 0) + assignment.quantity
        );
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedParts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const part of parts) {
        const assigned = assignedTotals.get(part.id) ?? 0;
        const unassigned = unassignedParts[part.id] ?? 0;
        const total = assigned + unassigned;
        if (next[part.id] !== total) {
          next[part.id] = total;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [parts, partsToPlates, unassignedParts]);

  const value = useMemo(
    () => ({
      plates,
      setPlates,
      selectedParts,
      setSelectedParts,
      parts,
      setParts,
      partsToPlates,
      setPartsToPlates,
      unassignedParts,
      setUnassignedParts,
    }),
    [plates, selectedParts, parts, partsToPlates, unassignedParts]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMaterialEvents() {
  const v = useContext(Ctx);
  if (!v)
    throw new Error(
      "useMaterialEvents must be used inside materialEventsProvider"
    );
  return v;
}
