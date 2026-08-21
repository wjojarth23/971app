"use client";

import styles from "./fusionserver.module.css";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Alert } from "@/app/signup/page";
import type { ApiKey } from "@/app/types";
import trpcClient from '@/lib/trpc/client';

// Scopes required for Fusion Server
const FUSION_SERVER_SCOPES = ["jobs:process", "parts:read", "plates:read", "tools:read", "materials:read", "machines:read", "box_tubes:read"];

// Check if server is active (had activity within the last 30 seconds)
function isServerActive(lastActivity: string | null): boolean {
  if (!lastActivity) return false;
  const lastActivityDate = new Date(lastActivity);
  const now = new Date();
  const diffMs = now.getTime() - lastActivityDate.getTime();
  return diffMs < 30000; // 30 seconds
}

export function Modal({
  children,
  open,
}: {
  children: ReactNode;
  open: boolean;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          id={styles.newApiKeyModal}
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function FusionServerPage() {
  const [fusionServers, setFusionServers] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { teamid } = useParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [clipboardModalOpen, setClipboardModalOpen] = useState(false);
  const [generatedApiKey, setGeneratedApiKey] = useState("");
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertText, setAlertText] = useState("");
  const [updates, setUpdates] = useState(true);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const teamDbId = Number(Array.isArray(teamid) ? teamid[0] : teamid);

  // Cleanup timeout on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(generatedApiKey);
    setCopied(true);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [generatedApiKey]);

  // Load existing fusion server API keys
  useEffect(() => {
    if (!Number.isFinite(teamDbId)) return;
    let mounted = true;
    setIsLoading(true);
    async function loadFusionServers() {
      try {
        const data = await trpcClient.teams.keys.get.query(teamDbId);
        if (mounted) {
          // Filter to only show keys marked as fusion server
          const fusionKeys = data.filter((key) => key.is_fusion_server);
          setFusionServers(fusionKeys);
        }
      } catch (error) {
        console.error("Error loading fusion servers:", error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    loadFusionServers();
    // Poll every 5 seconds to update status
    const interval = setInterval(loadFusionServers, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [teamDbId, updates]);

  useEffect(() => {
    if (modalOpen === false) {
      setAlertOpen(false);
    }
  }, [modalOpen]);

  useEffect(() => {
    if (clipboardModalOpen === false) {
      setGeneratedApiKey("");
    }
  }, [clipboardModalOpen]);

  async function handleModalSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name") as string;

    if (!Number.isFinite(teamDbId)) return;

    try {
      // Call the API key endpoint with fusion server scopes and flag
      const token = await trpcClient.teams.keys.create.mutate({
        name,
        scopes: FUSION_SERVER_SCOPES,
        is_fusion_server: true,
        team_id: teamDbId
      });
      setModalOpen(false);
      setUpdates(!updates);
      setGeneratedApiKey(token);
      setClipboardModalOpen(true);
    } catch {
      setAlertText("Fusion Server Name Already Exists");
      setAlertOpen(true);
    }
  }

  async function deleteFusionServer(apiKeyId: number) {
    if (apiKeyId == undefined) {
      return;
    }
    try {
      await trpcClient.teams.keys.delete.mutate(apiKeyId);
      setUpdates(!updates);
    } catch {}
  }

  return (
    <div className={styles.fusionserverpage}>
      <h1>Fusion Server</h1>
      <div id={styles.addFusionServer} onClick={() => setModalOpen(true)}>
        <Image
          src="/settings/teams/Plus.svg"
          width={2000}
          height={2000}
          alt="logo"
          onClick={() => setModalOpen(true)}
          className={styles.addIcon}
        />
      </div>
      <div>
        <div id={styles.fusionServerList}>
          {isLoading ? (
            <div id={styles.noFusionServersContainer}>
              <span id={styles.loadingSpinner} />
            </div>
          ) : fusionServers.length === 0 ? (
            <div id={styles.noFusionServersContainer}>
              <span id={styles.noFusionServers}>No Fusion Servers Added</span>
            </div>
          ) : null}
          {fusionServers.map((server, index) => {
            const active = isServerActive(server.last_activity);
            return (
              <div key={index} className={styles.fusionServerItem}>
                <span className={styles.fusionServerName}>
                  <span>{server.name}</span>
                </span>
                <span className={styles.fusionServerStatus}>
                  <span className={active ? styles.statusActive : styles.statusInactive}>
                    {active ? "Active" : "Inactive"}
                  </span>
                </span>
                <Image
                  src="/settings/teams/apikey/Remove.svg"
                  width={2000}
                  height={2000}
                  alt="remove"
                  className={styles.removeIcon}
                  onClick={(e) => {
                    e.preventDefault();
                    deleteFusionServer(server.id);
                  }}
                />
              </div>
            );
          })}
        </div>
        <Modal open={modalOpen}>
          <form onSubmit={handleModalSubmit} id={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div id={styles.headerImage}>
                <Image
                  src="/settings/teams/apikey/name.svg"
                  width={2000}
                  height={2000}
                  alt="logo"
                  className={styles.nameIcon}
                />
              </div>
              <div id={styles.modalTitle}>
                <h1>Add Fusion Server</h1>
                <span>Enter a name for your Fusion Server</span>
              </div>
            </div>
            <hr className={styles.divider} />
            <div id={styles.inputContainer}>
              <input
                type="text"
                name="name"
                placeholder="Name"
                minLength={3}
                required
              />
              <Alert
                open={alertOpen}
                message={alertText}
                className={styles.alert}
              />
            </div>
            <button id={styles.modalClose} type="submit">
              Done
            </button>
            <Image
              src="/settings/teams/apikey/Close.svg"
              width={2000}
              height={2000}
              alt="logo"
              onClick={() => setModalOpen(false)}
              className={styles.closeIcon}
            />
          </form>
        </Modal>
        <Modal open={clipboardModalOpen}>
          <form id={styles.modalContent}>
            <div className={styles.modalHeader}>
              <div id={styles.headerImage}>
                <Image
                  src="/settings/teams/apikey/name.svg"
                  width={2000}
                  height={2000}
                  alt="logo"
                  className={styles.nameIcon}
                />
              </div>
              <div id={styles.modalTitle}>
                <h1>Fusion Server API Key</h1>
                <span>Copy and save your new API Key</span>
              </div>
            </div>
            <hr className={styles.divider} />
            <div id={styles.inputContainer}>
              <div className={styles.scopeInput} id={styles.generatedInput}>
                <span id={styles.generatedKey}>
                  {generatedApiKey.slice(0, 5)}
                </span>
                <span id={styles.astericks}>
                  *************************************************************************************************************************************************************
                </span>
                <div id={styles.copyIconContainer}>
                  <Image
                    src={
                      copied
                        ? "/settings/teams/apikey/Check.svg"
                        : "/settings/teams/apikey/Copy.svg"
                    }
                    width={2000}
                    height={2000}
                    alt="copy"
                    className={styles.copyIcon}
                    onClick={handleCopy}
                  />
                </div>
              </div>
            </div>
            <button
              id={styles.modalClose}
              type="button"
              onClick={() => setClipboardModalOpen(false)}
            >
              Done
            </button>
            <Image
              src="/settings/teams/apikey/Close.svg"
              width={2000}
              height={2000}
              alt="logo"
              onClick={() => setClipboardModalOpen(false)}
              className={styles.closeIcon}
            />
          </form>
        </Modal>
      </div>
    </div>
  );
}
