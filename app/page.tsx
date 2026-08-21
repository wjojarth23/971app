"use client";
import styles from "./page.module.css";
import { motion } from "framer-motion";
import { PrimaryButton, SecondaryButton } from "@/components/Buttons/Buttons";
import HeroBackground from "@/components/HeroBackground/HeroBackground";
import localFont from "next/font/local";
import { Roboto } from "next/font/google";
import { authClient } from "@/lib/auth/client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

const zalando = localFont({
  src: "../public/index/ZalandoSansExpanded-VariableFont_wght.ttf",
  variable: "--font-zalando",
});
const roboto = Roboto({
  subsets: ["latin"],
  variable: "--font-roboto",
  display: "swap",
});

function DashboardPreview() {
  return (
    <div className={styles.dashboardPreview}>
      {/* Window chrome */}
      <div className={styles.previewChrome}>
        <div className={styles.previewDots}>
          <span className={styles.dotRed} />
          <span className={styles.dotYellow} />
          <span className={styles.dotGreen} />
        </div>
        <span className={styles.previewUrl}>autocam.app/dashboard</span>
      </div>

      {/* Dashboard content */}
      <div className={styles.previewContent}>
        {/* Sidebar */}
        <div className={styles.previewSidebar}>
          <div className={styles.previewLogo} />
          <div className={styles.previewNavItem} />
          <div className={styles.previewNavItem} />
          <div className={styles.previewNavItem} />
          <div className={styles.previewNavItem} />
        </div>

        {/* Main area */}
        <div className={styles.previewMain}>
          {/* Cards grid */}
          <div className={styles.previewCards}>
            <div className={styles.previewCard}>
              <div className={styles.previewCardHeader} />
              <div className={styles.previewCardBody}>
                <div className={styles.previewLine} />
                <div className={styles.previewLine} />
              </div>
              <div className={styles.previewCardButton} />
            </div>
            <div className={styles.previewCard}>
              <div className={styles.previewCardHeader} />
              <div className={styles.previewCardBody}>
                <div className={styles.previewLine} />
                <div className={styles.previewLine} />
              </div>
              <div className={styles.previewCardButton} />
            </div>
            <div className={styles.previewCard}>
              <div className={styles.previewCardHeader} />
              <div className={styles.previewCardBody}>
                <div className={styles.previewLine} />
                <div className={styles.previewLine} />
              </div>
              <div className={styles.previewCardButton} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Header({
  delay = 1,
  duration = 0.5,
}: {
  delay?: number;
  duration?: number;
}) {
  const router = useRouter();
  const [session, setSession] = useState<boolean | null>(null);
  useEffect(() => {
    authClient.getSession().then((s) => setSession(s.data != null));
  });
  if (session === null) return;

  return (
    <div id={styles.header}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: delay, duration: duration }}
      >
        <button id={styles.headerlogoButton} onClick={() => router.push("/")}>
          <Image
            src="/index/Document.svg"
            width={2000}
            height={2000}
            alt="logo"
            id={styles.headerlogo}
          />
        </button>
        <div>
          {session ? (
            <PrimaryButton
              id={styles.loginbutton}
              onClick={() => router.push("/dashboard")}
              style={{ right: "10px" }}
            >
              <span className={styles.textGradient}>DASHBOARD</span>
            </PrimaryButton>
          ) : (
            <>
              <SecondaryButton
                id={styles.loginbutton}
                onClick={() => router.push("/login")}
              >
                <span className={styles.textGradient}>LOGIN</span>
              </SecondaryButton>
              <PrimaryButton
                id={styles.signupbutton}
                onClick={() => router.push("/signup")}
              >
                <span className={styles.textGradient}>SIGNUP</span>
              </PrimaryButton>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default function Home() {
  return (
    <div
      className={zalando.variable + " " + roboto.variable}
      id={styles.container}
    >
      <HeroBackground />

      <Header />

      {/* Hero Section */}
      <section id={styles.heroSection}>
        <h1 id={styles.mainHeading}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            the <span className={styles.mainHeadingLargeText}>Future</span> of{" "}
            <span className={styles.mainHeadingLargeText}>FRC&apos;s</span>
          </motion.div>
        </h1>
        <h1 id={styles.secondaryHeading}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
          >
            <span className={styles.secondarytextGradient}>
              Computer-Aided Manufacturing
            </span>
          </motion.div>
        </h1>
      </section>

      {/* About Section */}
      <section id={styles.aboutSection}>
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: false, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className={styles.aboutContent}
        >
          <div className={styles.aboutText}>
            <h2 className={styles.sectionTitle}>What is AutoCAM?</h2>
            <p className={styles.aboutDescription}>
              AutoCAM is a revolutionary platform designed specifically for
              FIRST Robotics Competition (FRC) teams. It streamlines the
              manufacturing process by automating CAM (Computer-Aided
              Manufacturing) toolpath generation directly from your CAD designs.
            </p>
            <p className={styles.aboutDescription}>
              Born from the challenges faced during competition season, AutoCAM
              eliminates hours of manual CAM programming, allowing teams to
              focus on what matters most—building winning robots. Our platform
              integrates seamlessly with Fusion 360, providing instant toolpaths
              for plates, box tubes, and complex parts.
            </p>
            <div className={styles.aboutFeatures}>
              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>⚡</span>
                <span>Instant Toolpath Generation</span>
              </div>
              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🤝</span>
                <span>Team Collaboration</span>
              </div>
              <div className={styles.featureItem}>
                <span className={styles.featureIcon}>🔧</span>
                <span>Fusion 360 Integration</span>
              </div>
            </div>
          </div>
          <div className={styles.aboutImageContainer}>
            <DashboardPreview />
          </div>
        </motion.div>
      </section>

      {/* Team Section */}
      <section id={styles.teamSection}>
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: false, amount: 0.5 }}
          transition={{ duration: 0.6 }}
        >
          <h2 className={styles.sectionTitle}>Meet the Team</h2>
          <p className={styles.teamSubtitle}>The developers behind AutoCAM</p>
        </motion.div>

        <div className={styles.teamGrid}>
          {/* Zachariah Sharma */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className={styles.teamCard}
          >
            <div className={styles.teamImageContainer}>
              <div className={styles.teamImagePlaceholder}>
                <span>ZS</span>
              </div>
            </div>
            <h3 className={styles.teamName}>Zachariah Sharma</h3>
            <p className={styles.teamRole}>Lead Developer, Designer, and Creator</p>
            <div className={styles.teamDivider} />
            <ul className={styles.teamContributions}>
              <li>
                Designed and developed the entire web interface from scratch
              </li>
              <li>
                Built the Fusion 360 AutoCAM integration from the ground up
              </li>
              <li>Developed plate and box tube workflow components</li>
              <li>Implemented responsive UI/UX across the platform</li>
            </ul>
          </motion.div>

          {/* Ishan Karmakar */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: false, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className={styles.teamCard}
          >
            <div className={styles.teamImageContainer}>
              <div className={styles.teamImagePlaceholder}>
                <span>IK</span>
              </div>
            </div>
            <h3 className={styles.teamName}>Ishan Karmakar</h3>
            <p className={styles.teamRole}>Lead Backend Architect</p>
            <div className={styles.teamDivider} />
            <ul className={styles.teamContributions}>
              <li>Architected the entire backend API infrastructure</li>
              <li>Built comprehensive OpenAPI documentation system</li>
              <li>Developed authentication and team management APIs</li>
              <li>Created database schemas and migration systems</li>
              <li>Implemented secure API key and permissions system</li>
            </ul>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer id={styles.footer}>
        <p>© 2025 AutoCAM. Built for the FRC community.</p>
      </footer>
    </div>
  );
}
