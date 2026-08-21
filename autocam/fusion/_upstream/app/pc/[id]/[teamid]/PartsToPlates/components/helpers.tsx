import { motion } from "framer-motion";
import type { PlatesJob } from "@/app/types";

export type PlateJobRun = {
  arrange: PlatesJob;
  cam?: PlatesJob;
};

export function classNames(
  ...classes: Array<string | false | null | undefined>
): string {
  return classes.filter(Boolean).join(" ");
}

export function buildPlateJobRuns(jobs: PlatesJob[]): PlateJobRun[] {
  const sorted = [...jobs].sort((a, b) => {
    if (a.queue_position !== b.queue_position)
      return a.queue_position - b.queue_position;
    return a.id - b.id;
  });

  const runs: PlateJobRun[] = [];
  for (const job of sorted) {
    if (job.kind === "arrange") {
      runs.push({ arrange: job });
      continue;
    }

    if (job.kind === "cam") {
      const target = runs.find((run) => !run.cam);
      if (target) {
        target.cam = job;
      } else {
        runs.push({ arrange: job });
      }
    }
  }

  return runs;
}

export function MotionPath() {
  return (
    <motion.svg
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      <motion.rect
        x=".5"
        y=".5"
        width="calc(100% - 1px)"
        height="calc(100% - 1px)"
        rx="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="10 8"
        animate={{ strokeDashoffset: [0, -36] }}
        transition={{
          duration: 1.2,
          ease: "linear",
          repeat: Infinity,
        }}
      />
    </motion.svg>
  );
}
