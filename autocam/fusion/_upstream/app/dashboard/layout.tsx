"use client";

import {
  DashboardEventsProvider,
  useDashboardEvents,
} from "@/app/dashboard/dashboardTeam";
import { SidebarProvider, useSidebar } from "@/app/dashboard/sidebarContext";
import styles from "./layout.module.css";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import trpcClient from '@/lib/trpc/client';
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useAnimate } from "framer-motion";
import { useSelectedLayoutSegment, usePathname } from "next/navigation";
import { inferRouterOutputs } from "@trpc/server";
import { AppRouter } from "@/lib/api";

type TeamList = inferRouterOutputs<AppRouter>["teams"]["get"];

// Patch performance.measure to suppress parallel route timing errors
if (typeof window !== "undefined" && window.performance?.measure) {
  const origMeasure = window.performance.measure.bind(window.performance);
  window.performance.measure = (...args: Parameters<Performance["measure"]>) => {
    try {
      return origMeasure(...args);
    } catch (err) {
      if (err instanceof Error && err.message.includes("cannot have a negative time stamp")) {
        return undefined as unknown as PerformanceMeasure;
      }
      throw err;
    }
  };
}

export function useCurrentTab() {
  const segment = useSelectedLayoutSegment("tabs");
  const path = usePathname();
  if (!segment && path.includes("/dashboard/settings"))
    return "settings";
  return segment ?? "default";
}

function TeamDropdown() {
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const { team, setTeam, teamsRefreshCount } = useDashboardEvents();
  const [teams, setTeams] = useState<TeamList>([]);
  const dropdownTeamRef = useRef<HTMLDivElement>(null);
  const { isCollapsed } = useSidebar();

  useEffect(() => {
    let mounted = true;
    async function loadTeams() {
      try {
        const data = await trpcClient.teams.get.query();
        if (mounted) {
          setTeams(data);
          if (!team) setTeam(data[0]);
        }
      } catch (err) {
        console.error("Failed to load teams:", err);
      }
    }
    loadTeams();
    return () => {
      mounted = false;
    };
  }, [setTeam, teamsRefreshCount, team]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownTeamRef.current &&
        !dropdownTeamRef.current.contains(e.target as Node)
      ) {
        setTeamDropdownOpen(false);
      }
    }

    if (teamDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [teamDropdownOpen]);

  if (isCollapsed) {
    return null; // Hide team dropdown when collapsed
  }

  return (
    <div className={styles.teamDropdownContainer}>
      <div
        id={styles.teamdropdown}
        onClick={() => setTeamDropdownOpen(!teamDropdownOpen)}
      >
        <span id={styles.dropdownSelectedText}>
          {team?.name || "No Teams Found"}
        </span>
        <Image
          src="/dashboard/dropdownTeam.svg"
          width={2000}
          height={2000}
          className={styles.teamdropdownIcon}
          alt="dropdown arrow"
        />
      </div>
      <AnimatePresence>
        {teamDropdownOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            id={styles.teamdropdownMenu}
            ref={dropdownTeamRef}
          >
            {teams.map((t, index) => (
              <div
                key={index}
                className={styles.teamdropdownItem}
                onClick={() => {
                  setTeam(t);
                  setTeamDropdownOpen(false);
                }}
              >
                <span>{t.name}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type SidebarSearchResults = {
  parts: Array<{
    id: number;
    name: string;
    epic: string;
    ticket: string;
    quantity: number;
    category: { id: number; material: string; thickness: number };
  }>;
  partCategories: Array<{ id: number; material: string; thickness: number }>;
  boxTubes: Array<{
    id: number;
    name: string;
    epic: string;
    ticket: string;
    quantity: number;
  }>;
};

function SidebarSearch() {
  const { team } = useDashboardEvents();
  const { isCollapsed } = useSidebar();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SidebarSearchResults | null>(null);

  useEffect(() => {
    setQuery("");
    setIsOpen(false);
    setIsLoading(false);
    setError(null);
    setResults(null);
  }, [team?.id]);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!team) {
      setIsLoading(false);
      setResults(null);
      setError(null);
      return;
    }

    const q = query.trim();
    if (q.length < 2) {
      setIsLoading(false);
      setResults(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/teams/${team.id}/search?q=${encodeURIComponent(q)}&limit=6`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error(`Search failed (${res.status})`);
        const data: SidebarSearchResults = await res.json();
        setResults(data);
      } catch (err) {
        if (
          (err instanceof DOMException || err instanceof Error) &&
          err.name === "AbortError"
        )
          return;
        console.error("Sidebar search error:", err);
        setError("Search failed");
        setResults(null);
      } finally {
        setIsLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, team]);

  if (isCollapsed) return null;

  const q = query.trim();
  const parts = results?.parts ?? [];
  const partCategories = results?.partCategories ?? [];
  const boxTubes = results?.boxTubes ?? [];
  const hasAnyResults =
    parts.length > 0 || partCategories.length > 0 || boxTubes.length > 0;

  function closeAndClear() {
    setIsOpen(false);
    setQuery("");
    setResults(null);
    setError(null);
    setIsLoading(false);
  }

  function openCategory(categoryId: number) {
    if (!team) return;
    router.push(`/pc/${categoryId}/${team.id}`);
    closeAndClear();
  }

  function openBoxTubes() {
    router.push("/dashboard/boxtubes");
    closeAndClear();
  }

  return (
    <div className={styles.sidebarSearchContainer} ref={containerRef}>
      <div className={styles.sidebarSearchInput}>
        <Image
          src="/settings/teams/search.svg"
          width={14}
          height={14}
          alt="Search"
          className={styles.sidebarSearchIcon}
        />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={team ? "Search parts, box tubes, categories" : "Select a team"}
          disabled={!team}
        />
        {query.length > 0 && (
          <button
            type="button"
            className={styles.sidebarSearchClear}
            onClick={closeAndClear}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <AnimatePresence>
        {isOpen && q.length >= 2 && (isLoading || error || results) && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className={styles.sidebarSearchResults}
          >
            {isLoading ? (
              <div className={styles.sidebarSearchEmpty}>Searching…</div>
            ) : error ? (
              <div className={styles.sidebarSearchEmpty}>{error}</div>
            ) : !hasAnyResults ? (
              <div className={styles.sidebarSearchEmpty}>No results</div>
            ) : (
              <>
                {parts.length > 0 && (
                  <div>
                    <div className={styles.sidebarSearchSectionHeader}>
                      Parts
                    </div>
                    {parts.map((p) => (
                      <div
                        key={`part-${p.id}`}
                        className={styles.sidebarSearchResultRow}
                        onClick={() => openCategory(p.category.id)}
                      >
                        <div className={styles.sidebarSearchResultMain}>
                          <div className={styles.sidebarSearchResultTitle}>
                            {p.name}
                          </div>
                          <div className={styles.sidebarSearchResultMeta}>
                            Epic {p.epic} · Ticket {p.ticket} · Qty {p.quantity}
                          </div>
                        </div>
                        <button
                          type="button"
                          className={styles.sidebarSearchCategoryPill}
                          onClick={(e) => {
                            e.stopPropagation();
                            openCategory(p.category.id);
                          }}
                          title="Open part category"
                        >
                          {p.category.material} · {p.category.thickness}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {partCategories.length > 0 && (
                  <div>
                    <div className={styles.sidebarSearchSectionHeader}>
                      Part Categories
                    </div>
                    {partCategories.map((c) => (
                      <div
                        key={`cat-${c.id}`}
                        className={styles.sidebarSearchResultRow}
                        onClick={() => openCategory(c.id)}
                      >
                        <div className={styles.sidebarSearchResultMain}>
                          <div className={styles.sidebarSearchResultTitle}>
                            {c.material}
                          </div>
                          <div className={styles.sidebarSearchResultMeta}>
                            Thickness {c.thickness}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {boxTubes.length > 0 && (
                  <div>
                    <div className={styles.sidebarSearchSectionHeader}>
                      Box Tubes
                    </div>
                    {boxTubes.map((bt) => (
                      <div
                        key={`bt-${bt.id}`}
                        className={styles.sidebarSearchResultRow}
                        onClick={openBoxTubes}
                      >
                        <div className={styles.sidebarSearchResultMain}>
                          <div className={styles.sidebarSearchResultTitle}>
                            {bt.name}
                          </div>
                          <div className={styles.sidebarSearchResultMeta}>
                            Epic {bt.epic} · Ticket {bt.ticket} · Qty {bt.quantity}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Sidebar() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const itemsRef = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const [scope, animate] = useAnimate();
  const router = useRouter();
  const tab = useCurrentTab();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const { draftCount } = useDashboardEvents();

  useEffect(() => {
    for (const key in itemsRef.current) {
      if (key === tab) {
        const element = itemsRef.current[key];
        if (element) {
          const rect = element.getBoundingClientRect();
          animate(
            scope.current,
            {
              top: rect.top,
              height: rect.height,
            },
            { duration: 0.3, ease: "easeInOut" }
          );
        }
      }
    }
  }, [tab, animate, scope, isCollapsed]);

  useEffect(() => {
    let cancelled = false;

    async function fetchSession() {
      try {
        const { data, error } = await authClient.getSession();

        if (cancelled) return;
        if (error || !data?.user) {
          setUsername("");
          setEmail("");
          return;
        }

        setUsername(data.user.name ?? "");
        setEmail(data.user.email ?? "");
      } catch (err) {
        if (!cancelled) console.error("Failed to fetch session:", err);
      }
    }

    fetchSession();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className={`${styles.sidebar} ${
        isCollapsed ? styles.sidebarCollapsed : ""
      }`}
    >
      <div className={styles.sidebarSelected} ref={scope}>
        <span className={styles.selectedYellow} />
        <span className={styles.selectedHighlight} />
      </div>
      <div className={styles.topSidebar}>
        <Image
          src="/dashboard/Sidebar/Hamburger.svg"
          width={2000}
          height={2000}
          alt="toggle sidebar icon"
          className={styles.Hamburgericon}
          onClick={toggleSidebar}
        />
        {!isCollapsed && (
          <>
            <Image
              src="/index/Document.svg"
              width={2000}
              height={2000}
              alt="Logo icon"
              onClick={() => router.push("/")}
              className={styles.logoicon}
            />
            <span className={styles.logoText + " secondarytextGradient"}>
              AutoCAM
            </span>
          </>
        )}
      </div>
      <div className={styles.teamDropdownWrapper}>
        <TeamDropdown />
      </div>
      {!isCollapsed && (
        <div className={styles.sidebarSearchWrapper}>
          <SidebarSearch />
        </div>
      )}
      {!isCollapsed && <hr id={styles.sidebarDivider} />}
      <div className={styles.sidebarItems}>
        <div>
          <div
            className={styles.sidebarItem}
            ref={(el) => {
              itemsRef.current["plates"] = el;
            }}
            onClick={() => {
              router.push("/dashboard/plates");
            }}
            title="Plates"
          >
            <Image
              src="/dashboard/Sidebar/Plates.svg"
              width={2000}
              height={2000}
              alt="Plates icon"
              className={styles.sidebaricon}
            />
            {!isCollapsed && <span>Plates</span>}
          </div>
          <div
            className={styles.sidebarItem}
            ref={(el) => {
              itemsRef.current["boxtubes"] = el;
            }}
            onClick={() => {
              router.push("/dashboard/boxtubes");
            }}
            title="Box Tubes"
          >
            <Image
              src="/dashboard/Sidebar/boxtubes.svg"
              width={2000}
              height={2000}
              alt="Box Tubes icon"
              className={styles.sidebaricon}
            />
            {!isCollapsed && <span>Box Tubes</span>}
          </div>
          {/* <div
            className={styles.sidebarItem}
            ref={(el) => {
              itemsRef.current["jobs"] = el;
            }}
            onClick={() => {
              router.push("/dashboard/jobs");
            }}
            title="Jobs"
          >
            <Image
              src="/dashboard/Sidebar/Jobs.svg"
              width={2000}
              height={2000}
              alt="Jobs icon"
              className={styles.sidebaricon}
            />
            {!isCollapsed && <span>Jobs</span>}
          </div> */}
          <div
            className={styles.sidebarItem}
            ref={(el) => {
              itemsRef.current["queue"] = el;
            }}
            onClick={() => {
              router.push("/dashboard/queue");
            }}
            title="Queue Manager"
          >
            <Image
              src="/dashboard/Sidebar/Queue.svg"
              width={2000}
              height={2000}
              alt="Queue icon"
              className={styles.sidebaricon}
            />
            {!isCollapsed && <span>Queue</span>}
          </div>
          <div
            className={styles.sidebarItem}
            ref={(el) => {
              itemsRef.current["upload"] = el;
            }}
            onClick={() => {
              router.push("/dashboard/upload");
            }}
            title="Upload"
          >
            <Image
              src="/dashboard/Sidebar/Upload.svg"
              width={2000}
              height={2000}
              alt="Upload icon"
              className={styles.sidebaricon}
            />
            {!isCollapsed && <span>Upload</span>}
          </div>
          <div
            className={styles.sidebarItem}
            ref={(el) => {
              itemsRef.current["drafts"] = el;
            }}
            onClick={() => {
              router.push("/dashboard/drafts");
            }}
            title="Drafts"
          >
            <Image
              src="/dashboard/Sidebar/Drafts.svg"
              width={2000}
              height={2000}
              alt="Drafts icon"
              className={styles.sidebaricon}
            />
            {!isCollapsed && (
              <div className={styles.sidebarItemWithBadge}>
                <span>Drafts</span>
                {draftCount > 0 && (
                  <span className={styles.draftBadge}>{draftCount}</span>
                )}
              </div>
            )}
            {isCollapsed && draftCount > 0 && (
              <span className={styles.draftBadgeCollapsed}>{draftCount}</span>
            )}
          </div>
        </div>
        <div>
          <div
            className={styles.sidebarItem}
            ref={(el) => {
              itemsRef.current["quantities"] = el;
            }}
            onClick={() => {
              router.push("/dashboard/quantities");
            }}
            title="Adjust Quantities"
          >
            <Image
              src="/dashboard/Sidebar/quantities.svg"
              width={2000}
              height={2000}
              alt="Adjust Quantities icon"
              className={styles.sidebaricon}
            />
            {!isCollapsed && <span>Adjust Quantities</span>}
          </div>
          <div
            className={styles.sidebarItem}
            ref={(el) => {
              itemsRef.current["settings"] = el;
            }}
            onClick={() => {
              router.push("/dashboard/settings/personal");
            }}
            title="Settings"
          >
            <Image
              src="/dashboard/Sidebar/settings.svg"
              width={2000}
              height={2000}
              alt="Settings icon"
              className={styles.sidebaricon}
            />
            {!isCollapsed && <span>Settings</span>}
          </div>
          <div
            className={styles.sidebarItem}
            onClick={async () => {
              await authClient.signOut();
              router.push("/login");
            }}
            title="Logout"
          >
            <Image
              src="/dashboard/Sidebar/logout.svg"
              width={2000}
              height={2000}
              alt="Logout icon"
              className={styles.sidebaricon}
            />
            {!isCollapsed && <span id={styles.logout}>Logout</span>}
          </div>
        </div>
      </div>
      <div className={styles.profile}>
        <div
          id={styles.profileContainer}
          className={isCollapsed ? styles.profileCollapsed : ""}
        >
          <Image
            src="/dashboard/UserIcon.svg"
            width={2000}
            height={2000}
            alt="user icon"
            id={styles.profileicon}
          />
          {!isCollapsed && (
            <div id={styles.profileinfo}>
              <span id={styles.username}>{username}</span>
              <span id={styles.email}>{email}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DashboardLayout({ tabs }: { tabs: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", "220px");
  }, []);

  return (
    <div className={styles.container}>
      <SidebarProvider>
        <DashboardEventsProvider>
          <div className={styles.mainContent}>
            <Sidebar />
            <main className={styles.main}>{tabs}</main>
          </div>
          <EmailVerificationModal />
          <EmailVerificationWarning />
        </DashboardEventsProvider>
      </SidebarProvider>
    </div>
  );
}

function EmailVerificationModal() {
  const { emailVerified, isLoadingAuth, userId, userEmail, sessionExpiresAt } =
    useDashboardEvents();
  const [dismissed, setDismissed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const storageKey =
    userId && !isLoadingAuth
      ? `autocam:emailVerificationModalDismissed:${userId}:${
          sessionExpiresAt ?? "unknown"
        }`
      : null;
  const isStorageDismissed =
    storageKey && typeof window !== "undefined"
      ? sessionStorage.getItem(storageKey) === "1"
      : false;
  const open =
    !isLoadingAuth &&
    !emailVerified &&
    !!userId &&
    !pathname.includes("/dashboard/settings/personal") &&
    !dismissed &&
    !isStorageDismissed;

  const close = () => {
    if (storageKey) {
      sessionStorage.setItem(storageKey, "1");
    }
    setDismissed(true);
  };

  if (!open) return null;

  return (
    <div className={styles.verificationModalOverlay} role="presentation">
      <div
        className={styles.verificationModal}
        role="dialog"
        aria-modal="true"
        aria-label="Verify your email"
      >
        <div className={styles.verificationModalHeader}>
          <div className={styles.verificationModalTitle}>
            Verify your email
          </div>
          <button
            type="button"
            className={styles.verificationModalClose}
            onClick={close}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className={styles.verificationModalBody}>
          <p className={styles.verificationModalText}>
            We sent a verification link to{" "}
            <span className={styles.verificationModalEmail}>
              {userEmail ?? "your email"}
            </span>
            . Please check your inbox (and spam) to verify your account.
          </p>
        </div>
        <div className={styles.verificationModalActions}>
          <button
            type="button"
            className={styles.verificationModalSecondary}
            onClick={close}
          >
            Not now
          </button>
          <button
            type="button"
            className={styles.verificationModalPrimary}
            onClick={() => {
              close();
              router.push("/dashboard/settings/personal");
            }}
          >
            Go to verification →
          </button>
        </div>
      </div>
    </div>
  );
}

function EmailVerificationWarning() {
  const { emailVerified, isLoadingAuth } = useDashboardEvents();
  const router = useRouter();

  if (isLoadingAuth || emailVerified) {
    return null;
  }

  return (
    <div className={styles.verificationWarning}>
      <Image
        src="/auth/Warning.svg"
        alt="Warning"
        width={20}
        height={20}
        className={styles.warningIcon}
      />
      <div className={styles.warningContent}>
        <span className={styles.warningText}>
          Email not verified. Some features are disabled.
        </span>
        <button
          className={styles.warningLink}
          onClick={() => router.push("/dashboard/settings/personal")}
        >
          Verify now →
        </button>
      </div>
    </div>
  );
}
