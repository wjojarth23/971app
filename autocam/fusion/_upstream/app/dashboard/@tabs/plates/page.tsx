"use client";

import { motion } from "framer-motion";
import styles from "./partcat.module.css";
import { PartCategory, Team } from "@/app/types";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useDashboardEvents } from "@/app/dashboard/dashboardTeam";
import { PrimaryButton, SecondaryButton } from "@/components/Buttons/Buttons";
function countUniquePartsByEpicArray(category: PartCategory) {
  const map = category.parts!.reduce<Map<string, number>>((acc, part) => {
    acc.set(part.epic, (acc.get(part.epic) ?? 0) + 1);
    return acc;
  }, new Map());

  return Array.from(map, ([epic, count]) => ({ epic, count }));
}

function PartCatCard({
  partcat,
  delay,
  teamid,
}: {
  partcat: PartCategory;
  delay: number;
  teamid: number;
}) {
  const router = useRouter();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: delay, duration: 0.3 }}
      className={styles.platecard}
      onClick={() => router.push(`/pc/${partcat.id}/${teamid}`)}
    >
      <div id={styles.platecardheader}>
        <span>{partcat.material}</span>{" "}
        <span id={styles.partcardheaderthickness}>{partcat.thickness}</span>
      </div>
      <div id={styles.platecardinfo}>
        <p id={styles.platecardquantity}>
          Quantity:
          {partcat.parts!.reduce((sum, { quantity }) => sum + quantity, 0)}
        </p>
        <p id={styles.platecardunique}>Unique: {partcat.parts!.length}</p>
      </div>
      <hr id={styles.horizontalrule} />
      <div>
        {partcat.parts!.length > 0 ? (
          <table id={styles.platecardpartstable}>
            <tbody>
              {countUniquePartsByEpicArray(partcat).map((part, index) => (
                <tr key={index}>
                  <td>{part.epic}</td>
                  <td>{part.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p id={styles.noparts}>No parts in this category.</p>
        )}
      </div>
      <div id={styles.openiconcontainer}>
        <Image
          src="/dashboard/Open.svg"
          width={2000}
          height={2000}
          alt="user icon"
          id={styles.openicon}
        />
      </div>
    </motion.div>
  );
}

async function fetchPartCategories({
  team,
}: {
  team: Team | null;
}): Promise<PartCategory[] | undefined> {
  if (team !== null) {
    const response = await fetch(`/api/teams/${team.id}/pc`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });
    if (response.ok) {
      const data = await response.json();
      for (const cat of data) {
        const partsResponse = await fetch(`/api/pc/${cat.id}/parts`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });
        if (partsResponse.ok) {
          const partsData = await partsResponse.json();
          cat.parts = partsData;
        } else {
          cat.parts = [];
        }
      }
      return data;
    }
    return [];
  }
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
        <p>You need to be part of a team to view plates and part categories.</p>
        <div className={styles.noTeamButtons}>
          <PrimaryButton onClick={() => router.push("/dashboard/settings/newteam")}>
            <span className="textGradient">Create a Team</span>
          </PrimaryButton>
          <SecondaryButton onClick={() => router.push("/dashboard/settings/jointeam")}>
            <span className="textGradient">Join a Team</span>
          </SecondaryButton>
        </div>
      </motion.div>
    </div>
  );
}

export default function Plates() {
  const { team } = useDashboardEvents();
  const [partcats, setCategories] = useState<PartCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  useEffect(() => {
    let mounted = true;
    if (!team) return () => {
      mounted = false;
    };
    const load = async () => {
      setIsLoading(true);
      const categories = await fetchPartCategories({ team });
      if (mounted && categories)
        setCategories(categories);
      if (mounted) {
        setIsLoading(false);
      }
    };
    if (team) {
      load();
    }
    return () => {
      mounted = false;
    };
  }, [team]);

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
      ) : partcats.length === 0 ? (
        <p id={styles.nopartcats}>No Categories available.</p>
      ) : (
        <div className={styles.plateslist}>
          {partcats.map((partcat, index) => (
            <PartCatCard
              key={index}
              partcat={partcat}
              delay={index * 0.2 + 0.3}
              teamid={team ? team.id : 0}
            />
          ))}
        </div>
      )}
    </>
  );
}
