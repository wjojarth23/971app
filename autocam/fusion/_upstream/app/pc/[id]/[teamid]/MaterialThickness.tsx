"use client";
import styles from "./materialthickness.module.css";
import { Material, PartCategory, Part, Plate } from "@/app/types";
import AvailableParts from "./AvailableParts/AvailableParts";
import { Header } from "./header/header";
import PlatesToCreate from "./PlatesToCreate/PlatesToCreate";
import { useEffect, useState } from "react";
import { useAnimate } from "framer-motion";
import { Unassigned } from "./PlateAssignment/Unassigned";
import { PartsToPlates } from "./PartsToPlates/PartsToPlates";
import { useRouter } from "next/navigation";
import { useMaterialEvents } from "./materialEvents";
import { authClient } from "@/lib/auth/client";

export default function MaterialThickness({
  pcid,
  teamid,
}: {
  pcid: string;
  teamid: string;
}) {
  const [scope, animate] = useAnimate();
  const [partcategory, setPartcategory] = useState<PartCategory | null>(null);
  const [teamMaterials, setTeamMaterials] = useState<Material[] | null>(null);
  const [teamTools, setTeamTools] = useState<
    { id: number; name: string }[] | null
  >(null);
  const [platesLoading, setPlatesLoading] = useState(true);
  const [unassignedLoading, setUnassignedLoading] = useState(true);
  const [isAdminOrOwner, setIsAdminOrOwner] = useState(false);
  const [isAddingMaterial, setIsAddingMaterial] = useState(false);
  const [addMaterialError, setAddMaterialError] = useState<string | null>(null);
  const [epicsMap, setEpicsMap] = useState<{ [key: string]: Part[] }>({});
  const router = useRouter();
  const {
    setParts,
    setPlates,
    plates,
    setSelectedParts,
    setPartsToPlates,
    setUnassignedParts,
  } = useMaterialEvents();

  useEffect(() => {
    if (!setPartsToPlates) return;
    setPartsToPlates((prev) => {
      let didChange = false;
      const next = { ...prev };
      for (const plate of plates) {
        if (next[plate.id] == null) {
          next[plate.id] = [];
          didChange = true;
        }
      }
      return didChange ? next : prev;
    });
  }, [plates, setPartsToPlates]);

  useEffect(() => {
    let mounted = true;
    async function fetchData() {
      setUnassignedLoading(true);
      try {
        const res = await fetch(`/api/teams/${teamid}/pc/`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });
        let data = await res.json();
        let found = false;
        for (const pc of data) {
          if (pc.id.toString() === pcid) {
            data = pc;
            found = true;
            break;
          }
        }
        if (found === false) {
          router.push("/404");
        }
        const response = await fetch(`/api/pc/${data.id}/parts`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });
        const partsData = await response.json();
        if (!mounted) return;
        setParts(partsData);
        const selectedPartsInit: { [key: string]: number } = {};
        for (const part of partsData) {
          selectedPartsInit[part.id] = 0;
        }
        setSelectedParts(selectedPartsInit);
        setUnassignedParts(selectedPartsInit);
        data.parts = partsData;
        setPartcategory(data);
        const mappedEpics: { [key: string]: Part[] } = {};
        data.parts.forEach((part: Part) => {
          if (!mappedEpics[part.epic]) {
            mappedEpics[part.epic] = [];
          }
          mappedEpics[part.epic].push(part);
        });
        setEpicsMap(mappedEpics);
      } finally {
        if (mounted) {
          setUnassignedLoading(false);
        }
      }
    }

    fetchData();
    return () => {
      mounted = false;
    };
  }, [pcid, router, setParts, setSelectedParts, setUnassignedParts, teamid]);

  useEffect(() => {
    if (!teamid) return;
    let mounted = true;

    async function loadTeamSettingsData() {
      setPlatesLoading(true);
      try {
        const { data } = await authClient.getSession();
        const currentUserEmail = data?.user?.email ?? null;

        const [materialsRes, toolsRes, platesRes, membersRes] =
          await Promise.all([
            fetch(`/api/teams/${teamid}/materials`),
            fetch(`/api/teams/${teamid}/tools`),
            fetch(`/api/pc/${pcid}/plates`),
            currentUserEmail ? fetch(`/api/teams/${teamid}/members`) : null,
          ]);

        if (!mounted) return;

        if (materialsRes.ok) {
          setTeamMaterials((await materialsRes.json()) as Material[]);
        } else {
          setTeamMaterials(null);
        }

        if (platesRes.ok) {
          setPlates((await platesRes.json()) as Plate[]);
        } else {
          setPlates([]);
        }

        if (toolsRes.ok) {
          const tools = (await toolsRes.json()) as Array<{ id: number; name: string }>;
          setTeamTools(tools.map((t) => ({ id: t.id, name: t.name })));
        } else {
          setTeamTools(null);
        }

        if (membersRes && membersRes.ok && currentUserEmail) {
          const members = (await membersRes.json()) as {
            email: string;
            admin: boolean;
            isOwner: boolean;
          }[];
          const me = members.find((m) => m.email === currentUserEmail);
          setIsAdminOrOwner(Boolean(me?.admin || me?.isOwner));
        } else {
          setIsAdminOrOwner(false);
        }
      } catch (error) {
        console.error("Error loading team settings data:", error);
        if (!mounted) return;
        setTeamMaterials(null);
        setTeamTools(null);
        setIsAdminOrOwner(false);
      } finally {
        if (mounted) {
          setPlatesLoading(false);
        }
      }
    }

    loadTeamSettingsData();
    return () => {
      mounted = false;
    };
  }, [teamid, pcid, setPlates]);

  const materialMissing =
    !!partcategory?.material &&
    teamMaterials !== null &&
    !teamMaterials.some((m) => m.name === partcategory.material);

  const toolsMissing = teamTools !== null && teamTools.length === 0;

  const showWarnings = materialMissing || toolsMissing;

  async function goToTeamSettings(tab: "Machines" | "Materials" | "Tools") {
    try {
      const teamsResponse = await fetch("/api/teams");
      if (!teamsResponse.ok) {
        router.push("/dashboard/settings/personal");
        return;
      }
      const teamsData = (await teamsResponse.json()) as { id: number }[];
      teamsData.sort((a, b) => a.id - b.id);
      const teamIndex = teamsData.findIndex(
        (t) => t.id === Number.parseInt(teamid, 10)
      );
      router.push(
        `/dashboard/settings/teams/${
          teamIndex >= 0 ? teamIndex : 0
        }?tab=${encodeURIComponent(tab)}`
      );
    } catch (error) {
      console.error("Error navigating to team settings:", error);
      router.push("/dashboard/settings/personal");
    }
  }

  async function addMissingMaterialAndGo() {
    if (!isAdminOrOwner || !partcategory?.material) return;
    setAddMaterialError(null);
    setIsAddingMaterial(true);
    try {
      const response = await fetch(`/api/teams/${teamid}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: partcategory.material }),
      });

      if (!response.ok && response.status !== 409) {
        const message = await response.text();
        setAddMaterialError(message || "Failed to add material");
        return;
      }

      await goToTeamSettings("Materials");
    } catch (error) {
      console.error("Error adding missing material:", error);
      setAddMaterialError("Failed to add material");
    } finally {
      setIsAddingMaterial(false);
    }
  }
  const hasPlates = plates.length > 0;
  const showPlateSection = hasPlates || platesLoading;

  useEffect(() => {
    animate(
      scope.current,
      { height: hasPlates ? "calc(50vh - 120px)" : "calc(100vh - 120px)" },
      { duration: 0.5 }
    );
  }, [animate, scope, hasPlates]);
  return (
    <div className={styles.container}>
      <Header
        material={partcategory?.material}
        thickness={partcategory?.thickness}
      />
      <div className={styles.contentData} ref={scope}>
        <AvailableParts epicsMap={epicsMap} sectionId="mt-parts" />
        <PlatesToCreate
          plates={plates}
          setPlates={setPlates}
          categoryId={partcategory !== null ? partcategory.id : 0}
          sectionId="mt-plates"
        />
      </div>
      {showPlateSection ? (
        <div className={styles.contentSorting}>
          <Unassigned loading={unassignedLoading} sectionId="mt-unassigned" />
          <PartsToPlates
            categoryId={partcategory !== null ? partcategory.id : 0}
            platesLoading={platesLoading}
            sectionId="mt-arrange"
          />
        </div>
      ) : null}
      {showWarnings ? (
        <div className={styles.warningToast} role="status" aria-live="polite">
          <div className={styles.warningToastTitle}>Team settings required</div>
          {materialMissing ? (
            <div className={styles.warningToastRow}>
              <div className={styles.warningToastText}>
                {isAdminOrOwner ? (
                  <>
                    No Team Settings material matches{" "}
                    <span className={styles.warningToastEmphasis}>
                      {partcategory?.material}
                    </span>
                    .
                  </>
                ) : (
                  <>
                    This material doesn’t exist in Team Settings. Please contact
                    an admin to adjust this.
                  </>
                )}
                {addMaterialError ? (
                  <div className={styles.warningToastError}>
                    {addMaterialError}
                  </div>
                ) : null}
              </div>
              {isAdminOrOwner ? (
                <button
                  className={styles.warningToastButton}
                  onClick={addMissingMaterialAndGo}
                  disabled={isAddingMaterial}
                >
                  {isAddingMaterial ? "Adding..." : "Add material"}
                </button>
              ) : null}
            </div>
          ) : null}

          {toolsMissing ? (
            <div className={styles.warningToastRow}>
              <div className={styles.warningToastText}>
                {isAdminOrOwner ? (
                  <>No tools are set up in Team Settings for this team.</>
                ) : (
                  <>
                    No tools are set up in Team Settings. Please contact an
                    admin to adjust this.
                  </>
                )}
              </div>
              {isAdminOrOwner ? (
                <button
                  className={styles.warningToastButton}
                  onClick={() => goToTeamSettings("Tools")}
                >
                  Add tools
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
