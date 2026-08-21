"use client";

import { motion } from "framer-motion";
import styles from "./quantities.module.css";
import { Part, PartCategory } from "@/app/types";
import { ChangeEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardEvents } from "@/app/dashboard/dashboardTeam";
import { ConditionalMarquee } from "@/app/dashboard/@tabs/boxtubes/ConditionalMarquee";
import { PrimaryButton, SecondaryButton } from "@/components/Buttons/Buttons";

function QuantitiesCard({ part, delay }: { part: Part; delay: number }) {
  const [quantity, setQuantity] = useState<number>(part.quantity);
  useEffect(() => {
    fetch(`/api/parts/${part.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ quantity: quantity }),
    });
  }, [part.id, quantity]);
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: delay, duration: 0.3 }}
      className={styles.quantitycard}
    >
      <div id={styles.quantitycardheader}>
        <ConditionalMarquee text={part.name} />
      </div>
      <div id={styles.quantitycardinfo}>
        <p id={styles.quantitycardoriginal}>Original: {part.original_quantity}</p>
        <p id={styles.quantitycardcurrent}>
          Current: <span>{quantity}</span>
        </p>
      </div>
      <div id={styles.quantitycardactions}>
        <div className={styles.counter}>
          <button
            className={styles.counterButtonMinus}
            onClick={() => {
              setQuantity((qty) => (qty > 0 ? qty - 1 : 0));
            }}
          >
            -
          </button>
          <input
            className={styles.counterValue}
            type="number"
            value={quantity}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setQuantity(Number(e.target.value));
            }}
          />
          <button
            className={styles.counterButtonPlus}
            onClick={() => {
              setQuantity((qty) => qty + 1);
            }}
          >
            +
          </button>
        </div>
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
        <p>You need to be part of a team to adjust part quantities.</p>
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

export default function Quantitys() {
  const { team } = useDashboardEvents();
  const [parts, setParts] = useState<Part[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadQuantitys = async () => {
      if (team === null || team === undefined) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      const response = await fetch(`/api/teams/${team.id}/pc`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok || !mounted) {
        if (mounted) setIsLoading(false);
        return;
      }

      const partCategories: PartCategory[] = await response.json();

      const partsByCategory = await Promise.all(
        partCategories.map(async (pt) => {
          const r = await fetch(`/api/pc/${pt.id}/parts`);
          if (!r.ok) return [];
          return (await r.json()) as Part[];
        })
      );

      if (mounted) {
      setParts(partsByCategory.flat());
        setIsLoading(false);
      }
    };
    loadQuantitys();
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
      ) : parts.length === 0 ? (
        <p id={styles.noboxes}>No Parts available.</p>
      ) : (
        <div className={styles.quantityslist}>
          {parts.map((part, index) => {
            return (
              <QuantitiesCard
                key={index}
                part={part}
                delay={index * 0.2 + 0.3}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
