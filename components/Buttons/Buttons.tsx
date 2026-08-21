import { ComponentProps } from "react";
import styles from "./button.module.css";

export function SecondaryButton(props: ComponentProps<"button">) {
  return (
    <button {...props} className={styles.secondaryButton}>
      {props.children}
    </button>
  );
}

export function PrimaryButton(props: ComponentProps<"button">) {
  return (
    <button {...props} className={styles.primaryButton}>
      {props.children}
    </button>
  );
}
