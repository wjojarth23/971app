"use client";

import { motion } from "framer-motion";
import styles from "./boxtubes.module.css";
import { BoxTube, Material } from "@/app/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardEvents } from "@/app/dashboard/dashboardTeam";
import { PrimaryButton, SecondaryButton } from "@/components/Buttons/Buttons";
import { ConditionalMarquee } from "./ConditionalMarquee";
import Image from "next/image";
import { BoxTubeCamModal } from "./BoxTubeCamModal";

type BoxTubeStatus = {
  status: "pending" | "in progress" | "completed";
  completedJobId?: number | null;
  queuePosition?: number | null;
  machiningTimeSeconds?: number | null;
};

type BoxTubeWithStatus = BoxTube & BoxTubeStatus;

type CamToolItem = {
  id: string;
  name: string;
  guid: string;
  libraryId: number;
  libraryName: string;
  default_selected?: boolean;
  machine_ids?: number[];
};

type CamMachine = {
  id: number;
  name: string;
  can_run_box_tubes?: boolean;
  box_tube_default_orientation?: "vertical" | "horizontal";
};

function formatMachiningTime(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

const PREFERRED_MATERIAL_PATTERN = /alum/i;
const DEFAULT_MATERIAL_NAME = "Aluminum";
const DEFAULT_ORIENTATION = "vertical";

function findPreferredMaterialId(materials: Material[]): number | null {
  const match = materials.find((material) =>
    PREFERRED_MATERIAL_PATTERN.test(material.name)
  );
  if (match) return match.id;
  return materials[0]?.id ?? null;
}

function getPreferredMaterialName(materials: Material[]): string {
  return (
    materials.find((material) =>
      PREFERRED_MATERIAL_PATTERN.test(material.name)
    )?.name ?? DEFAULT_MATERIAL_NAME
  );
}

function getMaterialNameById(
  materials: Material[],
  materialId: number | null
): string | null {
  if (materialId == null) return null;
  const material = materials.find((item) => item.id === materialId);
  return material?.name ?? null;
}

function getMachiningTimeSeconds(response: unknown): number | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as { total_machining_time?: unknown })
    .total_machining_time;
  return typeof value === "number" && value >= 0 ? value : null;
}

function BoxTubeCard({
  boxtube,
  delay,
  onRequestCam,
  requesting,
  jobError,
  onShowError,
  onDownload,
  downloading,
}: {
  boxtube: BoxTubeWithStatus;
  delay: number;
  onRequestCam: (boxtube: BoxTubeWithStatus) => void;
  requesting: boolean;
  jobError?: string;
  onShowError?: () => void;
  onDownload?: (boxtube: BoxTubeWithStatus) => void;
  downloading?: boolean;
}) {
  const downloadReady = boxtube.completedJobId != null;
  const pendingWithQueue =
    boxtube.status === "pending" && boxtube.queuePosition != null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: delay, duration: 0.3 }}
      className={styles.boxtubecard}
    >
      <div id={styles.boxtubecardheader}>
        <ConditionalMarquee text={boxtube.name} />
      </div>
      <div id={styles.boxtubecardinfo}>
        <ConditionalMarquee
          id={styles.boxtubecardepic}
          text={`Epic: ${boxtube.epic ?? ""}`}
        />
        <p id={styles.boxtubecardquantity}>Quantity: {boxtube.quantity}</p>
        {boxtube.status === "completed" &&
        boxtube.machiningTimeSeconds != null ? (
          <p className={styles.boxtubeMachiningTime}>
            Machining time: {formatMachiningTime(boxtube.machiningTimeSeconds)}
          </p>
        ) : null}
      </div>
      <div id={styles.boxtubecardactions}>
        {boxtube.status === "completed" ? (
          <div id={styles.boxtubecardcompletedactions}>
            <PrimaryButton
              id={styles.downloadboxtubebutton}
              disabled={downloading || !downloadReady}
              onClick={() => onDownload?.(boxtube)}
            >
              <span className="textGradient">
                <Image
                  src="/dashboard/download.svg"
                  alt="download"
                  width={16}
                  height={16}
                />{" "}
                Download
              </span>
            </PrimaryButton>
            <div id={styles.removeboxtubebutton}>
              <Image
                src="/dashboard/remove.svg"
                alt="remove"
                width={2000}
                height={2000}
                id={styles.removeicon}
              />
            </div>
          </div>
        ) : boxtube.status === "in progress" ? (
          <div className={styles.boxtubecardcamdisabled}>
            <span className={styles.ellipsis1}>.</span>
            <span className={styles.ellipsis2}>.</span>
            <span className={styles.ellipsis3}>.</span>
          </div>
        ) : pendingWithQueue ? (
          <SecondaryButton id={styles.requestcambutton} disabled>
            <span className="textGradient">
              In queue: {boxtube.queuePosition}
            </span>
          </SecondaryButton>
        ) : jobError ? (
          <button
            className={styles.errorButton}
            onClick={onShowError}
            type="button"
          >
            <span className={styles.errorDot} />
            View Error
          </button>
        ) : (
          <SecondaryButton
            id={styles.requestcambutton}
            disabled={requesting}
            onClick={() => onRequestCam(boxtube)}
          >
            <span className="textGradient">CAM</span>
            {requesting ? (
              <span className={styles.requestingDots}>...</span>
            ) : null}
          </SecondaryButton>
        )}
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
        <p>You need to be part of a team to view box tubes.</p>
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

export default function Boxtubes() {
  const { team } = useDashboardEvents();
  const [boxtubes, setBoxTubes] = useState<BoxTubeWithStatus[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [machines, setMachines] = useState<CamMachine[]>([]);
  const [tools, setTools] = useState<
    Array<{
      id: number;
      name: string;
      machine_ids?: number[];
      material_ids?: number[];
      default_selected?: boolean;
    }>
  >([]);
  const [requestingJob, setRequestingJob] = useState<Record<number, boolean>>(
    {}
  );
  const [jobErrors, setJobErrors] = useState<Record<number, string>>({});
  const [activeError, setActiveError] = useState<{
    message: string;
    boxTubeName?: string;
  } | null>(null);
  const [downloading, setDownloading] = useState<Record<number, boolean>>({});
  const [camModalOpen, setCamModalOpen] = useState(false);
  const [camModalTube, setCamModalTube] = useState<BoxTubeWithStatus | null>(
    null
  );
  const [camModalError, setCamModalError] = useState<string | null>(null);
  const [camModalLoading, setCamModalLoading] = useState(false);
  const [camSubmitting, setCamSubmitting] = useState(false);
  const [camSelectedMachineId, setCamSelectedMachineId] = useState<
    number | null
  >(null);
  const [camSelectedToolIds, setCamSelectedToolIds] = useState<string[]>([]);
  const [camToolItems, setCamToolItems] = useState<CamToolItem[]>([]);
  const [camOrientation, setCamOrientation] = useState(DEFAULT_ORIENTATION);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [camMaterialId, setCamMaterialId] = useState<number | null>(null);
  const [camMaterialOverride, setCamMaterialOverride] = useState(false);
  const boxtubesRef = useRef<BoxTubeWithStatus[]>([]);
  const eligibleMachines = useMemo(
    () => machines.filter((machine) => machine.can_run_box_tubes),
    [machines]
  );
  const activeMaterialId = useMemo(() => {
    return (
      camMaterialId ??
      team?.box_tube_material_id ??
      findPreferredMaterialId(materials)
    );
  }, [camMaterialId, materials, team]);
  const eligibleMaterialToolIds = useMemo(() => {
    if (activeMaterialId == null) return null;
    const matched = tools
      .filter((tool) =>
        (tool.material_ids ?? []).some((id) => id === activeMaterialId)
      )
      .map((tool) => tool.id);
    return matched.length > 0 ? new Set(matched) : null;
  }, [activeMaterialId, tools]);
  const availableCamTools = useMemo(() => {
    const machineFiltered =
      camSelectedMachineId == null
        ? camToolItems
        : camToolItems.filter((tool) => {
            const machineIds = tool.machine_ids ?? [];
            if (machineIds.length === 0) return true;
            return machineIds.includes(camSelectedMachineId);
          });
    if (!eligibleMaterialToolIds) return machineFiltered;
    return machineFiltered.filter((tool) =>
      eligibleMaterialToolIds.has(tool.libraryId)
    );
  }, [camSelectedMachineId, camToolItems, eligibleMaterialToolIds]);
  const camModalBusy = camModalLoading || camSubmitting;

  useEffect(() => {
    let mounted = true;
    const loadBoxTubes = async () => {
      if (team === null || team === undefined) {
        setBoxTubes([]);
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      const response = await fetch(`/api/teams/${team.id}/boxTubes`, {
        method: "GET",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      });
      if (response.ok) {
        const data = await response.json();
        if (mounted) {
          const statusedData = (
            await Promise.all(
              data.map(async (bt: BoxTube) => {
                const meta = await fetchJobMeta(bt.id);
                return { ...bt, ...meta };
              })
            )
          ).filter(Boolean) as BoxTubeWithStatus[];
          setBoxTubes(statusedData);
        }
      }
      if (mounted) {
        setIsLoading(false);
      }
    };
    loadBoxTubes();
    return () => {
      mounted = false;
    };
  }, [team]);

  useEffect(() => {
    const loadMachinesAndTools = async () => {
      if (!team) return;
      try {
        const [mRes, tRes, materialsRes] = await Promise.all([
          fetch(`/api/teams/${team.id}/machines`),
          fetch(`/api/teams/${team.id}/tools`),
          fetch(`/api/teams/${team.id}/materials`),
        ]);
        if (mRes.ok) {
          const machineData = (await mRes.json()) as CamMachine[];
          setMachines(
            machineData.map((machine) => ({
              ...machine,
              can_run_box_tubes: Boolean(machine.can_run_box_tubes),
              box_tube_default_orientation:
                machine.box_tube_default_orientation === "horizontal"
                  ? "horizontal"
                  : DEFAULT_ORIENTATION,
            }))
          );
        }
        if (tRes.ok) {
          setTools(
            (await tRes.json()) as Array<{
              id: number;
              name: string;
              machine_ids?: number[];
              default_selected?: boolean;
            }>
          );
        }
        if (materialsRes.ok) {
          setMaterials((await materialsRes.json()) as Material[]);
        } else {
          setMaterials([]);
        }
      } catch (err) {
        console.error("Failed to load machines/tools", err);
        setMaterials([]);
      }
    };
    loadMachinesAndTools();
  }, [team]);

  useEffect(() => {
    if (!camModalOpen || !team) return;
    let mounted = true;
    setCamModalLoading(true);
    setCamModalError(null);
    async function loadToolItems() {
      try {
        const libraryTools = await Promise.all(
          tools.map(async (toolLibrary) => {
            try {
              const libraryRes = await fetch(
                `/api/tools/${toolLibrary.id}/library`
              );
              if (!libraryRes.ok) {
                console.error(
                  "Failed to load tool library",
                  toolLibrary.id,
                  await libraryRes.text()
                );
                return [];
              }
              const libraryData = (await libraryRes.json()) as {
                data?: Array<{
                  guid?: string;
                  description?: string;
                  default_selected?: boolean;
                }>;
              };
              if (!Array.isArray(libraryData.data)) return [];
              return libraryData.data.map((toolItem, index) => {
                const guid = toolItem.guid ?? `tool-${index + 1}`;
                const name = toolItem.description || `Tool ${index + 1}`;
                return {
                  id: `${toolLibrary.id}:${guid}`,
                  name,
                  guid,
                  libraryId: toolLibrary.id,
                  libraryName: toolLibrary.name,
                  default_selected: Boolean(toolItem.default_selected),
                  machine_ids: toolLibrary.machine_ids,
                } as CamToolItem;
              });
            } catch (err) {
              console.error(
                "Error loading tool library",
                toolLibrary.id,
                err
              );
              return [];
            }
          })
        );
        if (!mounted) return;
        setCamToolItems(libraryTools.flat());
      } catch (err) {
        console.error("Failed to load tool libraries", err);
        if (!mounted) return;
        setCamModalError("Failed to load tool libraries.");
        setCamToolItems([]);
      } finally {
        if (mounted) {
          setCamModalLoading(false);
        }
      }
    }
    loadToolItems();
    return () => {
      mounted = false;
    };
  }, [camModalOpen, team, tools]);

  useEffect(() => {
    if (!camModalOpen) return;
    setCamSelectedMachineId((prev) => {
      if (prev != null && eligibleMachines.some((m) => m.id === prev))
        return prev;
      return eligibleMachines[0]?.id ?? null;
    });
  }, [camModalOpen, eligibleMachines]);

  useEffect(() => {
    if (!camModalOpen) return;
    if (camSelectedMachineId == null) {
      setCamOrientation(DEFAULT_ORIENTATION);
      return;
    }
    const machine = machines.find((m) => m.id === camSelectedMachineId);
    const defaultOrientation =
      machine?.box_tube_default_orientation === "horizontal"
        ? "horizontal"
        : DEFAULT_ORIENTATION;
    setCamOrientation(defaultOrientation);
  }, [camModalOpen, camSelectedMachineId, machines]);

  useEffect(() => {
    if (!camModalOpen) return;
    const preferredId =
      team?.box_tube_material_id ?? findPreferredMaterialId(materials);
    setCamMaterialId(preferredId ?? null);
    setCamMaterialOverride(false);
  }, [camModalOpen, materials, team]);

  useEffect(() => {
    if (!camModalOpen) return;
    setCamSelectedToolIds((prev) => {
      const valid = prev.filter((id) =>
        availableCamTools.some((tool) => tool.id === id)
      );
      if (valid.length > 0) return valid;
      const defaults = availableCamTools
        .filter((tool) => tool.default_selected)
        .map((tool) => tool.id);
      if (defaults.length > 0) return defaults;
      if (availableCamTools.length > 0)
        return availableCamTools.map((tool) => tool.id);
      return [];
    });
  }, [camModalOpen, availableCamTools]);

  useEffect(() => {
    boxtubesRef.current = boxtubes;
  }, [boxtubes]);

  useEffect(() => {
    if (!team) return;
    let cancelled = false;

    const refreshJobStatuses = async () => {
      const current = boxtubesRef.current;
      if (current.length === 0) return;
      const updates = await Promise.all(
        current.map(async (bt) => ({
          id: bt.id,
          meta: await fetchJobMeta(bt.id),
        }))
      );
      if (cancelled) return;
      setBoxTubes((prev) =>
        prev.map((bt) => {
          const next = updates.find((u) => u.id === bt.id);
          return next ? { ...bt, ...next.meta } : bt;
        })
      );
    };

    refreshJobStatuses();
    const interval = setInterval(() => {
      refreshJobStatuses().catch(() => {});
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [team]);

  async function fetchJobMeta(boxTubeId: number): Promise<BoxTubeStatus> {
    try {
      const response = await fetch(`/api/boxTubes/${boxTubeId}/jobs`, {
        method: "GET",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      });
      if (!response.ok)
        return {
          status: "pending",
          completedJobId: null,
          queuePosition: null,
          machiningTimeSeconds: null,
        };
      const jobs: Array<{
        status?: string;
        id?: number;
        queue_position?: number;
        response?: unknown;
      }> = await response.json();
      if (!Array.isArray(jobs) || jobs.length === 0)
        return {
          status: "pending",
          completedJobId: null,
          queuePosition: null,
          machiningTimeSeconds: null,
        };
      const queuePosition =
        jobs
          .map((j) =>
            typeof j.queue_position === "number" ? j.queue_position : null
          )
          .filter((n): n is number => n !== null)
          .sort((a, b) => a - b)[0] ?? null;
      const completed = jobs
        .filter(
          (job) => job.status === "completed" && typeof job.id === "number"
        )
        .sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      const inProgress = jobs.some((job) => job.status === "in progress");
      if (completed.length > 0) {
        const latestCompleted = completed[0];
        const machiningTimeSeconds = getMachiningTimeSeconds(
          latestCompleted.response
        );
        return {
          status: "completed",
          completedJobId: latestCompleted.id ?? null,
          queuePosition: null,
          machiningTimeSeconds,
        };
      }
      if (inProgress)
        return {
          status: "in progress",
          completedJobId: null,
          queuePosition,
          machiningTimeSeconds: null,
        };
      return {
        status: "pending",
        completedJobId: null,
        queuePosition,
        machiningTimeSeconds: null,
      };
    } catch (err) {
      console.error("Failed to fetch jobs for box tube", boxTubeId, err);
      return {
        status: "pending",
        completedJobId: null,
        queuePosition: null,
        machiningTimeSeconds: null,
      };
    }
  }

  function openCamModal(boxtube: BoxTubeWithStatus) {
    setJobErrors((prev) => {
      const next = { ...prev };
      delete next[boxtube.id];
      return next;
    });
    setCamModalTube(boxtube);
    setCamOrientation(DEFAULT_ORIENTATION);
    setCamModalError(null);
    setCamModalOpen(true);
  }

  function closeCamModal() {
    setCamModalOpen(false);
    setCamModalTube(null);
    setCamModalError(null);
    setCamModalLoading(false);
    setCamSubmitting(false);
    setCamSelectedToolIds([]);
    setCamToolItems([]);
    setCamMaterialOverride(false);
    setCamMaterialId(null);
  }

  function handleToggleMaterialOverride() {
    setCamMaterialOverride((prev) => {
      const next = !prev;
      if (!next) {
        setCamMaterialId(
          team?.box_tube_material_id ?? findPreferredMaterialId(materials)
        );
      }
      return next;
    });
  }

  function handleSelectMaterial(materialId: number) {
    setCamMaterialId(materialId);
  }

  function toggleCamTool(toolId: string) {
    setCamSelectedToolIds((prev) =>
      prev.includes(toolId)
        ? prev.filter((id) => id !== toolId)
        : [...prev, toolId]
    );
  }

  function toggleCamToolLibrary(toolIds: string[]) {
    if (toolIds.length === 0) return;
    setCamSelectedToolIds((prev) => {
      const allSelected = toolIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !toolIds.includes(id));
      }
      const next = new Set(prev);
      for (const id of toolIds) next.add(id);
      return Array.from(next);
    });
  }

  async function submitCamJob() {
    if (!team || !camModalTube) return;
    setCamModalError(null);
    if (camSelectedMachineId == null) {
      setCamModalError("Select a machine to continue.");
      return;
    }
    if (availableCamTools.length === 0) {
      setCamModalError(
        "No tools match this machine. Update your Tool Library in Settings → Fusion Inputs."
      );
      return;
    }
    const selectedTools = camSelectedToolIds.filter((id) =>
      availableCamTools.some((tool) => tool.id === id)
    );
    const selectedToolItems = availableCamTools.filter((tool) =>
      selectedTools.includes(tool.id)
    );
    if (selectedToolItems.length === 0) {
      setCamModalError("Select at least one tool to continue.");
      return;
    }
    const toolLibraryIds = Array.from(
      new Set(selectedToolItems.map((tool) => tool.libraryId))
    );
    const toolItems = selectedToolItems.map((tool) => ({
      tool_id: tool.libraryId,
      tool_guid: tool.guid,
    }));
    setCamSubmitting(true);
    setRequestingJob((prev) => ({ ...prev, [camModalTube.id]: true }));
    try {
      const materialIdToSend = activeMaterialId ?? null;
      const payload: Record<string, unknown> = {
        machine_id: camSelectedMachineId,
        tool_ids: toolLibraryIds,
        tool_items: toolItems,
        orientation: camOrientation,
      };

      if (materialIdToSend != null) {
        payload.material_id = materialIdToSend;
      }

      const res = await fetch(`/api/boxTubes/${camModalTube.id}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const message = await res.text();
        setCamModalError(message || "Failed to request CAM job.");
        setJobErrors((prev) => ({
          ...prev,
          [camModalTube.id]: message || "Failed to request CAM job.",
        }));
        return;
      }
      const nextStatus = await fetchJobMeta(camModalTube.id);
      setBoxTubes((prev) =>
        prev.map((bt) =>
          bt.id === camModalTube.id ? { ...bt, ...nextStatus } : bt
        )
      );
      closeCamModal();
    } catch (err) {
      console.error("Failed to request CAM job:", err);
      setCamModalError("Failed to request CAM job.");
      setJobErrors((prev) => ({
        ...prev,
        [camModalTube.id]: "Failed to request CAM job.",
      }));
    } finally {
      setCamSubmitting(false);
      setRequestingJob((prev) => {
        const next = { ...prev };
        delete next[camModalTube.id];
        return next;
      });
    }
  }

  async function downloadBoxTube(bt: BoxTubeWithStatus) {
    const { id: boxTubeId, name, completedJobId } = bt;
    setActiveError(null);
    setDownloading((prev) => ({ ...prev, [boxTubeId]: true }));
    try {
      if (!completedJobId) {
        throw new Error(
          "No CAM bundle available yet. Please try again once the job completes."
        );
      }
      const res = await fetch(`/api/jobs/${completedJobId}`);
      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || "Failed to fetch CAM bundle.");
      }
      const data = await res.json();
      const url = typeof data?.file === "string" ? data.file : null;
      if (!url) {
        throw new Error("No CAM bundle available for this job.");
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name ?? "boxtube"}-cam`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to download CAM file for this box tube.";
      setActiveError({ message, boxTubeName: name });
    } finally {
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[boxTubeId];
        return next;
      });
    }
  }

  // Show no team card if user has no team
  if (!team && !isLoading) {
    return <NoTeamCard />;
  }

  return (
    <>
      {isLoading ? (
        <div id={styles.loadingContainer}>
          <span id={styles.loadingSpinner} />
        </div>
      ) : boxtubes.length === 0 ? (
        <p id={styles.noboxes}>No Box Tubes available.</p>
      ) : (
        <>
          <div className={styles.boxtubeslist}>
            {boxtubes.map((boxtube, index) => (
              <BoxTubeCard
                key={boxtube.id}
                boxtube={boxtube}
                delay={index * 0.2 + 0.3}
                onRequestCam={openCamModal}
                requesting={Boolean(requestingJob[boxtube.id])}
                jobError={jobErrors[boxtube.id]}
                onShowError={
                  jobErrors[boxtube.id]
                    ? () =>
                        setActiveError({
                          message: jobErrors[boxtube.id],
                          boxTubeName: boxtube.name,
                        })
                    : undefined
                }
                onDownload={downloadBoxTube}
                downloading={Boolean(downloading[boxtube.id])}
              />
            ))}
          </div>
          <BoxTubeCamModal
            open={camModalOpen}
            loading={camModalBusy}
            error={camModalError}
            machines={eligibleMachines}
            selectedMachineId={camSelectedMachineId}
            onSelectMachine={setCamSelectedMachineId}
            availableTools={availableCamTools.map((tool) => ({
              id: tool.id,
              name: tool.name,
              libraryId: tool.libraryId,
              libraryName: tool.libraryName,
            }))}
            selectedToolIds={camSelectedToolIds}
            onToggleTool={toggleCamTool}
            onToggleToolLibrary={toggleCamToolLibrary}
            materials={materials}
            materialOverride={camMaterialOverride}
            selectedMaterialId={activeMaterialId}
            onToggleMaterialOverride={handleToggleMaterialOverride}
            onSelectMaterial={handleSelectMaterial}
            fallbackMaterialName={
              getMaterialNameById(materials, activeMaterialId) ??
              getPreferredMaterialName(materials)
            }
            orientation={camOrientation}
            onSelectOrientation={setCamOrientation}
            onClose={closeCamModal}
            onSubmit={submitCamJob}
          />
          {activeError ? (
            <div
              className={styles.errorModalOverlay}
              role="presentation"
              onClick={() => setActiveError(null)}
            >
              <div
                className={styles.errorModal}
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
              >
                <h3>Error requesting CAM job</h3>
                {activeError.boxTubeName ? (
                  <p className={styles.errorModalSubtitle}>
                    Box Tube: {activeError.boxTubeName}
                  </p>
                ) : null}
                <p className={styles.errorModalBody}>{activeError.message}</p>
                <button
                  type="button"
                  className={styles.errorModalClose}
                  onClick={() => setActiveError(null)}
                >
                  Close
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
