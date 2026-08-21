import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Marquee from "react-fast-marquee";

type ConditionalMarqueeProps = {
  text: string;
  id?: string;
  className?: string;
  speed?: number;
  pauseOnHover?: boolean;
  gradient?: boolean;
  gradientColor?: string | [number, number, number];
};

export function ConditionalMarquee({
  text,
  id,
  className,
  speed = 40,
  pauseOnHover = true,
}: ConditionalMarqueeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const measureRef = useRef<HTMLSpanElement | null>(null);

  const measure = () => {
    const container = containerRef.current;
    const measurer = measureRef.current;
    if (!container || !measurer) return;

    const next = measurer.scrollWidth > container.clientWidth;
    setOverflowing((prev) => (prev === next ? prev : next));
  };

  // Measure ASAP after layout
  useLayoutEffect(() => {
    measure();
  }, [text]);

  // Re-measure on resize (and when fonts finish loading)
  useEffect(() => {
    measure();

    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    if (textRef.current) ro.observe(textRef.current);

    // Fonts can change widths after initial render
    const fontSet = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
    fontSet?.ready?.then(() => measure());

    return () => ro.disconnect();
  }, [text]);

  return (
    <div
      id={id}
      ref={containerRef}
      className={className}
      style={{ overflowX: "hidden", overflowY: "visible", position: "relative" }}
    >
      <span
        ref={measureRef}
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {text}
      </span>

      {overflowing ? (
        <Marquee speed={speed} pauseOnHover={pauseOnHover}>
          <span style={{ whiteSpace: "nowrap" }}>{text}</span>
          <span style={{ paddingRight: 32 }} />
        </Marquee>
      ) : (
        <span
          style={{
            display: "block",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {text}
        </span>
      )}
    </div>
  );
}
