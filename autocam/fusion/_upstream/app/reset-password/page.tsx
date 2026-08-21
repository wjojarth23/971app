"use client";
import styles from "./reset-password.module.css";
import { motion } from "framer-motion";
import { SecondaryButton } from "@/components/Buttons/Buttons";
import { Header } from "@/app/page";
import { authClient } from "@/lib/auth/client";
import { FormEvent, useState, Dispatch, SetStateAction, Suspense } from "react";
import { RobotPic } from "../signup/page";
import { useSearchParams } from "next/navigation";
import { ErrorModal } from "../dashboard/@tabs/settings/@settingstabs/teams/[teamid]/ApiKeys/ApiKeys";

function ResetPasswordContainer({
  setErrorModalOpen,
}: {
  setErrorModalOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const resetPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");
    if (!token) {
      setStatus("error");
      setMessage("Reset link is missing or expired.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    setPending(true);
    setStatus("idle");
    setMessage(null);
    const { error } = await authClient.resetPassword({
      newPassword,
      token,
    });
    if (error) {
      setStatus("error");
      setMessage(error.message || "Unable to reset password.");
      if (!error.message) {
        setErrorModalOpen(true);
      }
      setPending(false);
      return;
    }

    setStatus("success");
    setMessage("Password updated. You can log in now.");
    setPending(false);
  };

  return (
    <motion.div
      initial={{ x: 100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 50, delay: 0.2, duration: 1 }}
      id={styles.resetcontainer}
    >
      <h1 id={styles.resetheader}>
        <span className={styles.secondarytextGradient}>Reset Password</span>
      </h1>
      <p id={styles.subtitle}>Choose a new password for your account.</p>
      <hr id={styles.horizontalrule} />
      <form onSubmit={resetPassword}>
        <label className={styles.inputLabel}>New Password</label>
        <br />
        <input
          type="password"
          placeholder="Enter new password"
          className={styles.input}
          name="newPassword"
          required
        />
        <label className={styles.inputLabel}>Confirm Password</label>
        <br />
        <input
          type="password"
          placeholder="Re-enter new password"
          className={styles.input}
          name="confirmPassword"
          required
        />
        {message && (
          <p
            className={
              status === "success" ? styles.statusSuccess : styles.statusError
            }
            aria-live="polite"
          >
            {message}
          </p>
        )}
        <SecondaryButton id={styles.resetbutton} type="submit" disabled={pending}>
          <span className={styles.resetbuttontext + " " + styles.textGradient}>
            {pending ? "UPDATING..." : "RESET PASSWORD"}
          </span>
        </SecondaryButton>
      </form>
      <div>
        <span id={styles.backToLoginText}>Ready to log in?</span>
        <a href="/login" id={styles.backToLogin}>
          Log In
        </a>
      </div>
    </motion.div>
  );
}

export default function ResetPasswordPage() {
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  return (
    <div>
      <Header delay={0.5} duration={0.5} />
      <RobotPic />
      <Suspense fallback={null}>
        <ResetPasswordContainer setErrorModalOpen={setErrorModalOpen} />
      </Suspense>
      <ErrorModal open={errorModalOpen} setOpen={setErrorModalOpen} />
    </div>
  );
}
