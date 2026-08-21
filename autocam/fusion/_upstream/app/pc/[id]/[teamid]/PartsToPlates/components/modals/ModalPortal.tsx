"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function ModalPortal({
  children,
}: {
  children: ReactNode;
}) {
  const [element] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    return document.createElement("div");
  });

  useEffect(() => {
    if (!element) return;
    document.body.appendChild(element);
    return () => {
      if (document.body.contains(element)) {
        document.body.removeChild(element);
      }
    };
  }, [element]);

  if (!element) {
    return null;
  }

  return createPortal(children, element);
}
