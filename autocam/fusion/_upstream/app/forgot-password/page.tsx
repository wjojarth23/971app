"use client";
import styles from "./forgot-password.module.css";
import { motion } from "framer-motion";
import { SecondaryButton } from "@/components/Buttons/Buttons";
import { Header } from "@/app/page";
import { authClient } from "@/lib/auth/client";
import { FormEvent, useState, Dispatch, SetStateAction } from "react";
import { RobotPic } from "../signup/page";
import { ErrorModal } from "../dashboard/@tabs/settings/@settingstabs/teams/[teamid]/ApiKeys/ApiKeys";

function ForgotPasswordContainer({
  setErrorModalOpen,
}: {
  setErrorModalOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const requestReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPending(true);
    setStatus("idle");
    setMessage(null);
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") ?? "");
    const { data, error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setStatus("error");
      setMessage(error.message || "Unable to send reset email.");
      if (!error.message) {
        setErrorModalOpen(true);
      }
      setPending(false);
      return;
    }

    setStatus("success");
    setMessage(
      data?.message ||
        "If this email exists in our system, check your inbox for a reset link."
    );
    setPending(false);
  };

  return (
    <motion.div
      initial={{ x: 100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 50, delay: 0.2, duration: 1 }}
      id={styles.forgotcontainer}
    >
      <h1 id={styles.forgotheader}>
        <span className={styles.secondarytextGradient}>Forgot Password</span>
      </h1>
      <p id={styles.subtitle}>
        Enter your email and we&apos;ll send a reset link.
      </p>
      <hr id={styles.horizontalrule} />
      <form onSubmit={requestReset}>
        <label className={styles.inputLabel}>Email</label>
        <br />
        <input
          type="email"
          placeholder="Enter your email"
          className={styles.input}
          name="email"
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
            {pending ? "SENDING..." : "SEND RESET LINK"}
          </span>
        </SecondaryButton>
      </form>
      <div>
        <span id={styles.backToLoginText}>Remembered your password?</span>
        <a href="/login" id={styles.backToLogin}>
          Log In
        </a>
      </div>
    </motion.div>
  );
}

export default function ForgotPasswordPage() {
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  return (
    <div>
      <Header delay={0.5} duration={0.5} />
      <RobotPic />
      <ForgotPasswordContainer setErrorModalOpen={setErrorModalOpen} />
      <ErrorModal open={errorModalOpen} setOpen={setErrorModalOpen} />
    </div>
  );
}
