"use client";
import { CSSProperties, useEffect, useRef, useState } from "react";

// A one-line title that scrolls back and forth when it does not fit its box, and sits still when it
// does. The overflow is measured on every resize, so it reacts to rotation and a longer page name.
export function MarqueeTitle({ text, className = "" }: { text: string; className?: string }) {
  const box = useRef<HTMLElement>(null), inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const outer = box.current, content = inner.current;
    if (!outer || !content) return;
    const measure = () => setOverflow(Math.max(0, Math.ceil(content.scrollWidth - outer.clientWidth)));
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    // Border box, so the side padding added once it scrolls is measured too.
    observer.observe(content, { box: "border-box" });
    return () => observer.disconnect();
  }, [text]);
  // Slower for a longer distance, so the reading speed stays about the same.
  const style = { "--marquee-shift": -overflow + "px", "--marquee-time": Math.max(6, overflow / 12) + "s" } as CSSProperties;
  return <strong ref={box} className={"marquee-title " + (overflow > 0 ? "is-overflowing " : "") + className} title={overflow > 0 ? text : undefined}>
    <span ref={inner} style={overflow > 0 ? style : undefined}>{text}</span>
  </strong>;
}
