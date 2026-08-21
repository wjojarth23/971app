"use client";

import { useEffect, useRef } from "react";
import styles from "./HeroBackground.module.css";

export default function HeroBackground() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const auroraRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const canvasEl: HTMLCanvasElement = canvas;
    const context: CanvasRenderingContext2D = ctx;

    const media =
      typeof window !== "undefined"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const reduceMotion = media?.matches ?? false;

    let width = 0;
    let height = 0;
    let animationFrameId: number | null = null;
    let isVisible = true;
    let auroraTimeoutId: number | null = null;

    type Particle = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      warm: boolean;
    };

    let particles: Particle[] = [];

    const aurora = auroraRef.current;
    const auroraDefaults = {
      x: 0,
      y: 0,
      rotate: 0,
      scale: 1,
    };

    function randomBetween(min: number, max: number) {
      return min + Math.random() * (max - min);
    }

    function setAuroraTransform() {
      if (!aurora) return;

      const x = randomBetween(-24, 24);
      const y = randomBetween(-18, 18);
      const rotate = randomBetween(-22, 22);
      const scale = randomBetween(1.1, 1.3);
      const duration = randomBetween(2.5, 4.5);

      aurora.style.setProperty("--aurora-duration", `${duration}s`);
      aurora.style.setProperty("--aurora-x", `${x}%`);
      aurora.style.setProperty("--aurora-y", `${y}%`);
      aurora.style.setProperty("--aurora-rotate", `${rotate}deg`);
      aurora.style.setProperty("--aurora-scale", `${scale}`);

      if (auroraTimeoutId != null) window.clearTimeout(auroraTimeoutId);
      auroraTimeoutId = window.setTimeout(setAuroraTransform, duration * 1000);
    }

    function startAurora() {
      if (!aurora || reduceMotion || auroraTimeoutId != null) return;
      if (document.visibilityState === "hidden" || !isVisible) return;
      setAuroraTransform();
    }

    function stopAurora() {
      if (auroraTimeoutId == null) return;
      window.clearTimeout(auroraTimeoutId);
      auroraTimeoutId = null;
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;

      canvasEl.width = Math.round(width * dpr);
      canvasEl.height = Math.round(height * dpr);
      canvasEl.style.width = `${width}px`;
      canvasEl.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const targetCount = Math.max(
        35,
        Math.min(80, Math.floor((width * height) / 24000))
      );
      const speed = Math.max(0.25, Math.min(0.65, width / 2200));

      particles = Array.from({ length: targetCount }, () => {
        const warm = Math.random() < 0.35;
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * speed,
          vy: (Math.random() - 0.5) * speed,
          r: warm ? 1.4 : 1.1,
          warm,
        };
      });
    }

    function drawFrame() {
      context.clearRect(0, 0, width, height);

      const maxDist = Math.max(110, Math.min(160, width / 9));

      for (let i = 0; i < particles.length; i += 1) {
        const p = particles[i];
        for (let j = i + 1; j < particles.length; j += 1) {
          const q = particles[j];
          const dx = p.x - q.x;
          const dy = p.y - q.y;
          const dist = Math.hypot(dx, dy);
          if (dist > maxDist) continue;

          const t = 1 - dist / maxDist;
          const alpha = t * t * 0.28;
          context.strokeStyle = q.warm
            ? `rgba(230, 221, 94, ${alpha})`
            : `rgba(255, 255, 255, ${alpha * 0.9})`;

          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(p.x, p.y);
          context.lineTo(q.x, q.y);
          context.stroke();
        }
      }

      for (const p of particles) {
        context.fillStyle = p.warm
          ? "rgba(230, 221, 94, 0.88)"
          : "rgba(255, 255, 255, 0.72)";
        context.beginPath();
        context.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        context.fill();
      }
    }

    function step() {
      if (reduceMotion || document.visibilityState === "hidden" || !isVisible) {
        animationFrameId = null;
        return;
      }
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -20) p.x = width + 20;
        else if (p.x > width + 20) p.x = -20;
        if (p.y < -20) p.y = height + 20;
        else if (p.y > height + 20) p.y = -20;
      }

      drawFrame();
      animationFrameId = window.requestAnimationFrame(step);
    }

    function start() {
      startAurora();
      if (reduceMotion || animationFrameId != null) return;
      if (document.visibilityState === "hidden" || !isVisible) return;
      animationFrameId = window.requestAnimationFrame(step);
    }

    function stop() {
      stopAurora();
      if (animationFrameId == null) return;
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    resize();
    drawFrame();

    window.addEventListener("resize", resize);

    const observer =
      typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver(
            ([entry]) => {
              isVisible = entry.isIntersecting;
              if (isVisible) start();
              else stop();
            },
            { threshold: 0.05 }
          )
        : null;
    observer?.observe(wrapper);

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") stop();
      else start();
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (aurora) {
      aurora.style.setProperty("--aurora-x", `${auroraDefaults.x}%`);
      aurora.style.setProperty("--aurora-y", `${auroraDefaults.y}%`);
      aurora.style.setProperty("--aurora-rotate", `${auroraDefaults.rotate}deg`);
      aurora.style.setProperty("--aurora-scale", `${auroraDefaults.scale}`);
      aurora.style.setProperty("--aurora-duration", "3.5s");
    }
    start();

    return () => {
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      observer?.disconnect();
      stopAurora();
      stop();
    };
  }, []);

  return (
    <div ref={wrapperRef} className={styles.wrapper} aria-hidden="true">
      <div ref={auroraRef} className={styles.aurora} />
      <div className={styles.overlay} />
      <canvas ref={canvasRef} className={styles.canvas} />
      <div className={styles.grain} />
    </div>
  );
}
