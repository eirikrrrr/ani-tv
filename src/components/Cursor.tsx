// Animated anime-style cursor: a precise pointer tip plus an original chibi
// character riding next to it. Browsers do not animate image cursors, so the
// system cursor is hidden and this layer follows the mouse instead.
//
// The characters are original drawings (no characters from existing series).

import { useEffect, useRef, type ComponentType } from "react";
import { t } from "../i18n";

export type BuiltinCursor = "neko" | "kitsune" | "mochi";
/** "system", a built-in character, or "custom:<id>" (an image the user added) */
export type CursorKind = "system" | BuiltinCursor | `custom:${string}`;

/** An image the user added (GIF/APNG/WebP/PNG), kept only on this computer.
 *  The image itself is in IndexedDB (cursorStore.ts); `src` only exists in
 *  saves from before that (a data URL). */
export type CustomCursor = { id: string; name: string; src?: string };
/** Largest image accepted. */
export const MAX_CUSTOM_BYTES = 10 * 1024 * 1024;
export type CursorSize = "s" | "m" | "l" | "xl";

export const CURSORS: { id: "system" | BuiltinCursor; label: string }[] = [
  { id: "system", label: t("Sistema") },
  { id: "neko", label: "Neko" },
  { id: "kitsune", label: "Kitsune" },
  { id: "mochi", label: "Mochi" },
];

/** "xl" is twice the large size */
const PX: Record<CursorSize, number> = { s: 34, m: 46, l: 60, xl: 120 };
const INK = "#2a2430";

function Eyes(props: { y: number; l: number; r: number }) {
  return (
    <>
      <ellipse className="ac-eye" cx={props.l} cy={props.y} rx="1.9" ry="2.6" fill={INK} />
      <ellipse className="ac-eye" cx={props.r} cy={props.y} rx="1.9" ry="2.6" fill={INK} />
      <circle cx={props.l + 0.6} cy={props.y - 1} r="0.7" fill="#fff" className="ac-shine" />
      <circle cx={props.r + 0.6} cy={props.y - 1} r="0.7" fill="#fff" className="ac-shine" />
    </>
  );
}

function Neko() {
  return (
    <svg viewBox="0 0 48 48" className="ac-svg">
      <path className="ac-tail" d="M33 38 C41 37 44 30 41 25" fill="none" stroke={INK} strokeWidth="5.2" strokeLinecap="round" />
      <path className="ac-tail" d="M33 38 C41 37 44 30 41 25" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="24" cy="37" rx="10.5" ry="7.5" fill="#fff" stroke={INK} strokeWidth="1.8" />
      <g className="ac-paws">
        <ellipse className="ac-paw-a" cx="19.5" cy="43.5" rx="3" ry="2.2" fill="#fff" stroke={INK} strokeWidth="1.6" />
        <ellipse className="ac-paw-b" cx="28.5" cy="43.5" rx="3" ry="2.2" fill="#fff" stroke={INK} strokeWidth="1.6" />
      </g>
      <g className="ac-head">
        <path className="ac-ear" d="M13.5 16 L13 4.5 L22 11 Z" fill="#fff" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path className="ac-ear" d="M34.5 16 L35 4.5 L26 11 Z" fill="#fff" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M15 13 L14.8 7.8 L19 11 Z" fill="#ffb3c4" />
        <path d="M33 13 L33.2 7.8 L29 11 Z" fill="#ffb3c4" />
        <circle cx="24" cy="21.5" r="12" fill="#fff" stroke={INK} strokeWidth="1.8" />
        <path d="M17 13.5 Q20 12 22 14.5 Q24 12 26 14.5 Q28 12 31 13.5" fill="none" stroke="#f4a62a" strokeWidth="2.2" strokeLinecap="round" />
        <Eyes y={22} l={19} r={29} />
        <ellipse cx="15.5" cy="26" rx="2.4" ry="1.4" fill="#ff8fa8" opacity=".6" />
        <ellipse cx="32.5" cy="26" rx="2.4" ry="1.4" fill="#ff8fa8" opacity=".6" />
        <path d="M21.5 26 Q22.8 27.6 24 26 Q25.2 27.6 26.5 26" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function Kitsune() {
  return (
    <svg viewBox="0 0 48 48" className="ac-svg">
      {[0, 1, 2].map((i) => (
        // the fan angle lives on the outer group: the CSS wag animation sets
        // `transform` on the inner one and would override an SVG attribute
        <g key={i} transform={`rotate(${-8 + i * 26} 33 38)`}>
          <g className="ac-tail" style={{ animationDelay: `${i * 0.18}s` }}>
            <path d="M32 38 C40 39 46 33 44 26 C40 30 36 31 32 34 Z" fill="#ff8a3d" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M44 26 C43.5 29 42 31 40 32 C41.6 29.6 42.6 28 44 26 Z" fill="#fff" />
          </g>
        </g>
      ))}
      <ellipse cx="24" cy="37" rx="10" ry="7.5" fill="#ff8a3d" stroke={INK} strokeWidth="1.8" />
      <ellipse cx="24" cy="39" rx="5" ry="4.2" fill="#fff6ec" />
      <g className="ac-paws">
        <ellipse className="ac-paw-a" cx="19.5" cy="43.5" rx="2.8" ry="2.1" fill="#3a2a2a" stroke={INK} strokeWidth="1.2" />
        <ellipse className="ac-paw-b" cx="28.5" cy="43.5" rx="2.8" ry="2.1" fill="#3a2a2a" stroke={INK} strokeWidth="1.2" />
      </g>
      <g className="ac-head">
        <path className="ac-ear" d="M14 15 L12 2.5 L22.5 10 Z" fill="#ff8a3d" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path className="ac-ear" d="M34 15 L36 2.5 L25.5 10 Z" fill="#ff8a3d" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M13.2 7 L12.6 3.4 L15.6 5.6 Z" fill={INK} />
        <path d="M34.8 7 L35.4 3.4 L32.4 5.6 Z" fill={INK} />
        <path d="M12 21.5 C12 13 18 9.5 24 9.5 C30 9.5 36 13 36 21.5 C36 29 30.5 33.5 24 33.5 C17.5 33.5 12 29 12 21.5 Z" fill="#ff8a3d" stroke={INK} strokeWidth="1.8" />
        <path d="M15 24 C17 30 21 32.5 24 32.5 C27 32.5 31 30 33 24 C30 26.5 27 27 24 27 C21 27 18 26.5 15 24 Z" fill="#fff6ec" />
        <path d="M24 12.5 L22.6 15.5 L24 17 L25.4 15.5 Z" fill="#e5162a" />
        <Eyes y={21.5} l={18.8} r={29.2} />
        <path d="M23 26.4 L24 27.4 L25 26.4" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <ellipse cx="15.6" cy="25" rx="2.2" ry="1.3" fill="#ff6f86" opacity=".55" />
        <ellipse cx="32.4" cy="25" rx="2.2" ry="1.3" fill="#ff6f86" opacity=".55" />
      </g>
    </svg>
  );
}

function Mochi() {
  return (
    <svg viewBox="0 0 48 48" className="ac-svg">
      <g className="ac-head ac-squish">
        <path d="M24 13 C25 9 28 7.5 31 8.5 C29 9.5 27 11 26 13.5" fill="#5bbf6a" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" className="ac-ear" />
        <path d="M6.5 36 C6.5 22 14 13.5 24 13.5 C34 13.5 41.5 22 41.5 36 C41.5 42 35 44.5 24 44.5 C13 44.5 6.5 42 6.5 36 Z" fill="#ffe3ec" stroke={INK} strokeWidth="1.8" />
        <path d="M11 25 C13 20 17 17.5 21 17" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".9" />
        <Eyes y={30} l={18} r={30} />
        <ellipse cx="13.5" cy="34" rx="2.6" ry="1.5" fill="#ff7c98" opacity=".6" />
        <ellipse cx="34.5" cy="34" rx="2.6" ry="1.5" fill="#ff7c98" opacity=".6" />
        <path d="M22 34 Q24 36 26 34" fill="none" stroke={INK} strokeWidth="1.4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

const ART: Record<BuiltinCursor, ComponentType> = { neko: Neko, kitsune: Kitsune, mochi: Mochi };

/** A built-in character, or the user's image with the same animations. */
function Figure(props: { kind: BuiltinCursor | null; image?: string | null }) {
  if (props.image) return <img src={props.image} alt="" draggable={false} className="ac-svg ac-img" />;
  const Art = ART[props.kind ?? "neko"];
  return <Art />;
}

/** The character alone, animated (Settings previews). */
export function CursorPreview(props: { kind?: BuiltinCursor; image?: string; size?: number }) {
  return (
    <span className="ac ac-preview inline-block" style={{ width: props.size ?? 52, height: props.size ?? 52 }}>
      <span className="ac-char block size-full">
        <Figure kind={props.kind ?? null} image={props.image} />
      </span>
    </span>
  );
}

const CLICKABLE = "a, button, [role=button], select, summary, label, input[type=checkbox], input[type=radio], article, [data-clickable]";
const TEXTUAL = "input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [contenteditable=true]";

export function AnimeCursor(props: { kind: CursorKind; size: CursorSize; image?: string | null }) {
  const root = useRef<HTMLDivElement>(null);
  const fx = useRef<HTMLDivElement>(null);
  const custom = props.kind.startsWith("custom:");
  // a custom cursor whose image was deleted falls back to the system pointer
  const enabled = props.kind !== "system" && (!custom || !!props.image);

  useEffect(() => {
    if (!enabled) return;
    const fine = window.matchMedia("(pointer: fine)").matches;
    if (!fine) return;
    const el = root.current!;
    const html = document.documentElement;
    html.dataset.cursor = "on";

    let x = -100;
    let y = -100;
    let lastX = 0;
    let frame = 0;
    let moveTimer = 0;
    let sleepTimer = 0;
    const cls = el.classList;

    const place = () => {
      frame = 0;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    };
    const wake = () => {
      cls.remove("sleep");
      clearTimeout(sleepTimer);
      sleepTimer = window.setTimeout(() => cls.add("sleep"), 9000);
    };
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (Math.abs(x - lastX) > 2) cls.toggle("left", x < lastX);
      lastX = x;
      cls.remove("gone");
      cls.add("moving");
      clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => cls.remove("moving"), 140);
      wake();
      const t = e.target as Element | null;
      cls.toggle("hover", !!t?.closest?.(CLICKABLE));
      cls.toggle("text", !!t?.closest?.(TEXTUAL));
      if (!frame) frame = requestAnimationFrame(place);
    };
    const onDown = (e: PointerEvent) => {
      cls.add("down");
      wake();
      // a little burst where the click landed
      const layer = fx.current;
      if (!layer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const b = document.createElement("span");
      b.className = "ac-burst";
      b.style.left = `${e.clientX}px`;
      b.style.top = `${e.clientY}px`;
      for (let i = 0; i < 6; i++) {
        const s = document.createElement("i");
        s.style.setProperty("--a", `${i * 60 + 15}deg`);
        b.appendChild(s);
      }
      layer.appendChild(b);
      setTimeout(() => b.remove(), 600);
    };
    const onUp = () => cls.remove("down");
    const onLeave = () => cls.add("gone");

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    wake();
    return () => {
      delete html.dataset.cursor;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("mouseleave", onLeave);
      clearTimeout(moveTimer);
      clearTimeout(sleepTimer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [enabled]);

  if (!enabled) return null;
  const builtin = custom ? null : (props.kind as BuiltinCursor);
  const px = PX[props.size];
  return (
    <>
      <div ref={fx} className="pointer-events-none fixed inset-0 z-[9998]" aria-hidden />
      <div ref={root} className="ac ac-live gone" aria-hidden>
        <svg className="ac-tip" width="16" height="20" viewBox="0 0 16 20">
          <path d="M1 1 L1 15.5 L5 11.8 L7.8 18 L10.6 16.7 L7.9 10.7 L13 10.5 Z" fill="var(--atv-accent)" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span className="ac-char" style={{ width: px, height: px }}>
          <Figure kind={builtin} image={custom ? props.image : null} />
        </span>
        <span className="ac-zzz" style={{ left: px - 2 }}>
          z
        </span>
      </div>
    </>
  );
}
