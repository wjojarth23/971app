"use client";
import styles from "./login.module.css";
import { motion } from "framer-motion";
import { SecondaryButton } from "@/components/Buttons/Buttons";
import { Header } from "@/app/page";
import { authClient } from "@/lib/auth/client";
import { useRouter } from "next/navigation";
import { FormEvent, useState, Dispatch, SetStateAction } from "react";
import { RobotPic } from "../signup/page";
import { Alert } from "../signup/page";
import { ErrorModal } from "../dashboard/@tabs/settings/@settingstabs/teams/[teamid]/ApiKeys/ApiKeys";

function LoginContainer({
  setErrorModalOpen,
}: {
  setErrorModalOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const router = useRouter();
  const [passwordAlertOpen, setPasswordAlertOpen] = useState(false);
  const [invalidEmailOpen, setInvalidEmailOpen] = useState(false);
  const login = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const result = await authClient.signIn.email(
      { email, password },
      {
        onSuccess: () => router.push("/dashboard"),
      }
    );
    if (result.error && result.error.message === "Invalid email or password") {
      setPasswordAlertOpen(true);
      setTimeout(() => {
        setPasswordAlertOpen(false);
      }, 3000);
    } else if (result.error && result.error.message === "Invalid email") {
      setInvalidEmailOpen(true);
      setTimeout(() => {
        setInvalidEmailOpen(false);
      }, 3000);
    } else if (result.error) {
      console.error(result.error);
      setErrorModalOpen(true);
    }
  };

  return (
    <motion.div
      initial={{ x: 100, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 50, delay: 0.2, duration: 1 }}
      id={styles.logincontainer}
    >
      <h1 id={styles.loginheader}>
        <span className={styles.secondarytextGradient}>Log In</span>
      </h1>
      <p id={styles.welcomeText}>Welcome back</p>
      <hr id={styles.horizontalrule} />
      <form onSubmit={login}>
        <label className={styles.inputLabel}>Email</label>
        <br />
        <input
          type="email"
          placeholder="Enter your email"
          className={styles.input}
          name="email"
          required
        />
        <Alert message={"Invalid email"} open={invalidEmailOpen} />
        <label className={styles.inputLabel}>Password</label>
        <br />
        <input
          type="password"
          placeholder="Enter your Password"
          className={styles.input}
          name="password"
          required
        />
        <Alert
          message={"Email or Password Incorrect"}
          open={passwordAlertOpen}
        />
        <SecondaryButton id={styles.loginbutton} type="submit">
          <span className={styles.loginbuttontext + " " + styles.textGradient}>
            LOG IN
          </span>
        </SecondaryButton>
      </form>
      <div>
        <span id={styles.alreadyHaveAccount}>
          Don&apos;t have an account yet?
        </span>
        <a href="/signup" id={styles.signup}>
          Sign Up
        </a>
      </div>
    </motion.div>
  );
}

export default function LoginPage() {
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  return (
    <div>
      <Header delay={0.5} duration={0.5} />
      <RobotPic />
      <LoginContainer setErrorModalOpen={setErrorModalOpen} />
      <ErrorModal open={errorModalOpen} setOpen={setErrorModalOpen} />
    </div>
  );
}
