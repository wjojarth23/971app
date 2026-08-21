import styles from "./header.module.css";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import Image from "next/image";

export function Header({
  delay = 0,
  duration = 0.5,
  material,
  thickness,
}: {
  delay?: number;
  duration?: number;
  material: string | undefined;
  thickness: number | undefined;
}) {
  const router = useRouter();
  const navItems = [
    { label: "Parts", href: "/dashboard/plates" },
    { label: "Boxtubes", href: "/dashboard/boxtubes" },
    { label: "Quantities", href: "/dashboard/quantities" },
    { label: "Upload", href: "/dashboard/upload" },
    { label: "Queue", href: "/dashboard/queue" },
  ];

  return (
    <div className={styles.header}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: delay, duration: duration }}
        className={styles.headerInner}
      >
        <div className={styles.brand}>
          <button
            className={styles.backButton}
            onClick={() => router.back()}
            aria-label="Go back"
          >
            <Image
              src="/mat_thickness/Back.svg"
              width={2000}
              height={2000}
              alt=""
              className={styles.backIcon}
            />
          </button>
          <button
            className={styles.logoButton}
            onClick={() => router.push("/dashboard")}
          >
            <Image
              src="/index/Document.svg"
              width={2000}
              height={2000}
              alt="AutoCAM"
              className={styles.logoIcon}
            />
          </button>
          <span className={styles.brandName}>AutoCAM</span>
        </div>

        <nav className={styles.nav} aria-label="Primary">
          {navItems.map((item) => (
            <button
              key={item.href}
              className={styles.navItem}
              onClick={() => router.push(item.href)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className={styles.meta}>
          <span className={styles.metaLabel}>Material</span>
          <span className={styles.metaValue}>
            {material ?? "—"}
          </span>
          <span className={styles.metaDivider} aria-hidden="true" />
          <span className={styles.metaLabel}>Thickness</span>
          <span className={styles.metaValue}>
            {typeof thickness === "number" ? thickness : "—"}
          </span>
        </div>
      </motion.div>
    </div>
  );
}
