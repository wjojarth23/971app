"use client";
import styles from "./layout.module.css";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useRef } from "react";
import { useSelectedLayoutSegments } from "next/navigation";
import { useAnimate } from "framer-motion";
import trpcClient from '@/lib/trpc/client';
export function useCurrentTab() {
  const segments = useSelectedLayoutSegments("settingstabs");
  console.log('SEGMENTS', segments)
  if (segments.length === 0) return "default";
  if (segments[1] === "teams") return segments[2] ?? "teams";
  return segments[1] ?? "default";
}
import { TabEventsProvider, useTabEvents } from "./teamUpdate";

function Sidebar() {
  const itemsRef = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [scope, animate] = useAnimate();
  const router = useRouter();
  const tab = useCurrentTab();
  const { updateCount, teams, setTeams } = useTabEvents();

  useEffect(() => {
    let mounted = true;
    (async function () {
      try {
        const teamsTemp = await trpcClient.teams.get.query();
        if (!mounted) return;
        teamsTemp.sort((a: { id: number }, b: { id: number }) => a.id - b.id);
        setTeams(teamsTemp);
      } catch (err) {
        if (mounted) console.error("Failed to fetch teams:", err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [updateCount, setTeams]);
  console.log(tab)
  useEffect(() => {
    // Determine which key to look for
    console.log('TAB CHANGE')
    let key = tab;
    if (tab === "default") {
      key = "personal";
    } else if (!isNaN(Number(tab))) {
      key = `team-${tab}`;
    }

    const element = itemsRef.current[key];
    const sidebar = sidebarRef.current;
    if (element && sidebar) {
      const rect = element.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      animate(
        scope.current,
        {
          top: rect.top - sidebarRect.top -5,
          height: rect.height,
        },
        { duration: 0.3, ease: "easeInOut" }
      );
    }
  }, [tab, teams, animate, scope]);

  return (
    <aside className={styles.sidebar} ref={sidebarRef}>
      <div className={styles.sidebarSelected} ref={scope}>
        <span className={styles.selectedYellow} />
        <span className={styles.selectedHighlight} />
      </div>
      <div
        ref={(el) => {
          itemsRef.current["personal"] = el;
        }}
        onClick={() => {
          if (tab !== "personal") {
            router.push("/dashboard/settings/personal");
          }
        }}
      >
        <Image
          src="/settings/personal.svg"
          width={2000}
          height={2000}
          alt="Personal Icon"
          className={styles.icon}
        />
        <span>Personal</span>
      </div>
      {teams.map((team) => (
        <div
          key={team.id}
          ref={(el) => {
            itemsRef.current[`team-${team.id}`] = el;
          }}
          onClick={() => {
            if (tab !== String(team.id)) {
              router.push("/dashboard/settings/teams/" + team.id);
            }
          }}
        >
          <Image
            src="/settings/team.svg"
            width={2000}
            height={2000}
            alt="Team Icon"
            className={styles.icon}
          />
          <span>{team.name}</span>
        </div>
      ))}
      <hr />
      <div
        ref={(el) => {
          itemsRef.current["newteam"] = el;
        }}
        onClick={() => {
          if (tab !== "newteam") {
            router.push("/dashboard/settings/newteam");
          }
        }}
      >
        <Image
          src="/settings/newteam.svg"
          width={2000}
          height={2000}
          alt="New Team Icon"
          className={styles.icon}
        />
        <span>New Team</span>
      </div>
      <div
        ref={(el) => {
          itemsRef.current["jointeam"] = el;
        }}
        onClick={() => {
          if (tab !== "jointeam") {
            router.push("/dashboard/settings/jointeam");
          }
        }}
      >
        <Image
          src="/settings/jointeam.svg"
          width={2000}
          height={2000}
          alt="Join Team Icon"
          className={styles.icon}
        />
        <span>Join Team</span>
      </div>
    </aside>
  );
}

export default function SettingsLayout({ settingstabs }: { settingstabs: React.ReactNode }) {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Settings</h1>
        <hr />
      </div>
      <TabEventsProvider>
        <div className={styles.mainContent}>
          <Sidebar />
          <main className={styles.main}>{settingstabs}</main>
        </div>
      </TabEventsProvider>
    </div>
  );
}
