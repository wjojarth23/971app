"use client";

import styles from "./apikeys.module.css";
import type { ApiKey } from "@/app/types";
import {
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Image from "next/image";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Alert } from "@/app/signup/page";
import { ConditionalMarquee } from "@/app/dashboard/@tabs/boxtubes/ConditionalMarquee";
import { ScopeEnum } from "@/lib/scopes";
import trpcClient from '@/lib/trpc/client';

const scopes = ScopeEnum.options;

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

export default function ApiKeysPage() {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { teamid } = useParams();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [selectedOpen, setSelectedOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [updates, setUpdates] = useState(true);
  const [generatedapikey, setGeneratedapikey] = useState("");
  const teamDbId = Number(Array.isArray(teamid) ? teamid[0] : teamid);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(generatedapikey);
    setCopied(true);
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }, [generatedapikey]);

  useEffect(() => {
    if (!Number.isFinite(teamDbId)) return;
    let mounted = true;
    setIsLoading(true);
    async function loadApiKeys() {
      try {
        const data = await trpcClient.teams.keys.get.query(teamDbId);
        if (mounted) {
          // Filter out fusion server keys - they're shown in a separate section
          setApiKeys(data.filter((key) => !key.is_fusion_server));
        }
      } catch (error) {
        console.error("Error loading API keys:", error);
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    loadApiKeys();
    return () => {
      mounted = false;
    };
  }, [teamDbId, updates]);
  useEffect(() => {
    if (modalOpen === false) {
      setSelectedScopes([]);
      setAlertOpen(false);
      setSelectedOpen(false);
    }
  }, [modalOpen]);
  useEffect(() => {
    if (selectedScopes.length > 0) {
      setAlertOpen(false);
    }
  }, [selectedScopes]);
  const [clipboardModalOpen, setClipboardModalOpen] = useState(false);
  const [alertText, setAlertText] = useState("");
  async function handleModalSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSelectedOpen(false);
    const formData = new FormData(e.currentTarget);
    const name = formData.get("name");
    if (!Number.isFinite(teamDbId)) return;
    if (selectedScopes.length === 0) {
      setAlertText("1+ Scopes Required");
      setAlertOpen(true);
      return;
    }
    try {
      const token = await trpcClient.teams.keys.create.mutate({
        name: name as string,
        scopes: selectedScopes,
        team_id: teamDbId
      });
      setModalOpen(false);
      setUpdates(!updates);
      setGeneratedapikey(token);
      setClipboardModalOpen(true);
    } catch (err) {
      setAlertText("API Key Name Already Exists");
      setAlertOpen(true);
    }
  }
  useEffect(() => {
    if (clipboardModalOpen === false) {
      setGeneratedapikey("");
    }
  }, [clipboardModalOpen]);

  async function deleteApiKey(apiKeyId: number) {
    if (apiKeyId == undefined) {
      return;
    }
    try {
      await trpcClient.teams.keys.delete.mutate(apiKeyId);
      setUpdates(!updates);
    } catch {}
  }

  return (
    <div className={styles.apikeyspage}>
      <div className={styles.apiKeysHeader}>
      <h1>API Keys</h1>
        <a
          href="/api/docs"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.docsLink}
        >
          <span>API Docs</span>
          <Image
            src="/dashboard/Open.svg"
            width={2000}
            height={2000}
            alt="open in new tab"
            className={styles.externalLinkIcon}
          />
        </a>
      </div>
      <div id={styles.addApiKey} onClick={() => setModalOpen(true)}>
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
        <div id={styles.apiKeysList}>
          {isLoading ? (
            <div id={styles.noApiKeysContainer}>
              <span id={styles.loadingSpinner} />
            </div>
          ) : apiKeys.length === 0 ? (
            <div id={styles.noApiKeysContainer}>
              <span id={styles.noApiKeys}>No API Keys Created</span>
            </div>
          ) : null}
          {apiKeys.map((apiKey, index) => (
            <div key={index} className={styles.apiKeyItem}>
              <span className={styles.apiKeyName}>
                <span>{apiKey.name}</span>
              </span>
              <ConditionalMarquee
                text={
                  apiKey.scopes === undefined
                  ? ""
                    : apiKey.scopes.join(", ")
                }
                className={styles.apiKeyValue}
                speed={30}
              />
              <Image
                src="/settings/teams/apikey/Remove.svg"
                width={2000}
                height={2000}
                alt="remove"
                className={styles.removeIcon}
                onClick={(e) => {
                  e.preventDefault();
                  deleteApiKey(apiKey.id);
                }}
              />
            </div>
          ))}
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
                <h1>Name & Scope:</h1>
                <span>Type the name and scope for your new API Key</span>
              </div>
            </div>
            <hr className={styles.divider} />
            <div id={styles.inputContainer}>
              <input
                type="text"
                name="name"
                placeholder="Name"
                min={3}
                required
              />
              <div
                onClick={() => setSelectedOpen(!selectedOpen)}
                className={styles.scopeInput}
              >
                <span id={styles.scopeTitle}>Scopes:</span>
                <span id={styles.modalScope}>
                  {selectedScopes.length} Selected
                </span>
                <Image
                  src="/settings/teams/apikey/Dropdown.svg"
                  width={2000}
                  height={2000}
                  alt="dropdown"
                  className={styles.dropdownIcon}
                />
              </div>
              <Alert
                open={alertOpen}
                message={alertText}
                className={styles.alert}
              />
            </div>
            <AnimatePresence>
              {selectedOpen && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  id={styles.dropdownScopes}
                >
                  {scopes.map((scope, index) => (
                    <div
                      key={index}
                      onClick={() => {
                        setSelectedScopes((prev) => {
                          const exists = prev.some((s) => s === scope);

                          return exists
                            ? prev.filter((s) => s !== scope)
                            : [...prev, scope];
                        });
                      }}
                    >
                      <label className={styles.checkbox}>
                        <input
                          type="checkbox"
                          name={`checkbox${scope}`}
                          checked={selectedScopes.some((s) => s === scope)}
                          onChange={() => {
                            setSelectedScopes((prev) => {
                              const exists = prev.some((s) => s === scope);

                              return exists
                                ? prev.filter((s) => s !== scope)
                                : [...prev, scope];
                            });
                          }}
                        />
                        <span className={styles.checkboxBox}>
                          <Image
                            src="/settings/teams/apikey/X.svg"
                            width={2000}
                            height={2000}
                            alt="logo"
                            className={styles.checkboxIcon}
                          />
                        </span>
                      </label>
                      <span>{scope}</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
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
                <h1>API Key</h1>
                <span>Copy and save your new API Key</span>
              </div>
            </div>
            <hr className={styles.divider} />
            <div id={styles.inputContainer}>
              <div
                onClick={() => setSelectedOpen(!selectedOpen)}
                className={styles.scopeInput}
                id={styles.generatedInput}
              >
                <span id={styles.generatedKey}>
                  {generatedapikey.slice(0, 5)}
                </span>
                <span id={styles.astericks}>
                  *************************************************************************************************************************************************************
                </span>
                <div id={styles.copyIconContainer}>
                    <Image
                      src={copied ? "/settings/teams/apikey/Check.svg" : "/settings/teams/apikey/Copy.svg"}
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

export function ErrorModal({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <Modal open={open}>
      <form id={styles.modalContent}>
        <div className={styles.modalHeader}>
          <div id={styles.headerImage}>
            <Image
              src="/auth/Error.svg"
              width={2000}
              height={2000}
              alt="error"
              className={styles.nameIcon}
            />
          </div>
          <div id={styles.modalErrorTitle}>
            <h1 id={styles.errorTitle}>OOPS!</h1>
            <span>Looks like we had a problem</span>
          </div>
        </div>
        <hr className={styles.divider} />
        <div id={styles.inputContainer}>
          <span>
            Check your internet connection, reload, and try again. I&apos;m sorry for
            the inconvenience!{" "}
          </span>
        </div>
        <button
          id={styles.modalClose}
          type="button"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
        <Image
          src="/auth/Close.svg"
          width={2000}
          height={2000}
          alt="logo"
          onClick={() => setOpen(false)}
          className={styles.closeIcon}
        />
      </form>
    </Modal>
  );
}
