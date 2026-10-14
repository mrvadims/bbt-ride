// Sky icons (24px grid, stroked; clear and mostly clear switch to a moon at night), level icons and UI icons.
import type { ReactNode } from "react";
import logoSvg from "../../brand/web/bbt-logo.svg?raw";
import type { Sport } from "../../shared/sports.ts";

export function wxLabel(c: number | null | undefined): string {
  if (c == null) return "–";
  if (c === 0) return "Clear";
  if (c === 1) return "Mostly clear";
  if (c === 2) return "Partly cloudy";
  if (c === 3) return "Overcast";
  if (c <= 48) return "Fog";
  if (c <= 57) return "Drizzle";
  if (c <= 67) return "Rain";
  if (c <= 77) return "Snow";
  if (c <= 82) return "Showers";
  if (c <= 86) return "Snow showers";
  return "Thunderstorms";
}

const Sun = () => (
  <>
    <circle cx="12" cy="12" r="4.2" fill="var(--sun)" stroke="none" />
    <path
      stroke="var(--sun)"
      d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"
    />
  </>
);
const Moon = () => <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" fill="var(--muted)" stroke="none" />;
const Cloud = ({ up = false }: { up?: boolean }) => (
  <path
    transform={up ? "translate(0,-3)" : undefined}
    d="M7 18h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 18z"
    fill="var(--cloud)"
    stroke="var(--cloud-edge)"
  />
);
const SunSmall = () => (
  <>
    <circle cx="8" cy="8" r="3.2" fill="var(--sun)" stroke="none" />
    <path stroke="var(--sun)" d="M8 1.8v1.4M2 8h1.4M3.6 3.6l1 1M12.4 3.6l-1 1" />
  </>
);
const MoonSmall = () => <path d="M12 9.5A5 5 0 0 1 6.5 4a5 5 0 1 0 5.5 5.5z" fill="var(--muted)" stroke="none" />;

export function WxIcon({ code, day = true }: { code: number | null | undefined; day?: boolean }) {
  const c = code ?? 0;
  let g: ReactNode;
  if (c === 0) g = day ? <Sun /> : <Moon />;
  else if (c === 1 || c === 2)
    g = (
      <>
        {day ? <SunSmall /> : <MoonSmall />}
        <Cloud />
      </>
    );
  else if (c === 3) g = <Cloud />;
  else if (c <= 48) g = <path stroke="var(--cloud-edge)" d="M4 9h16M3 13h18M5 17h14" />;
  else if (c <= 57)
    g = (
      <>
        <Cloud up />
        <path stroke="var(--rain)" d="M9 20.5v1M13 20.5v1M17 20.5v1" />
      </>
    );
  else if (c <= 67 || (c >= 80 && c <= 82))
    g = (
      <>
        {c >= 80 && day && <SunSmall />}
        <Cloud up />
        <path stroke="var(--rain)" d="M8 20l-1 2.2M12 20l-1 2.2M16 20l-1 2.2" />
      </>
    );
  else if (c <= 77 || c === 85 || c === 86)
    g = (
      <>
        <Cloud up />
        <g fill="var(--rain)" stroke="none">
          <circle cx="8" cy="21" r="1" />
          <circle cx="12" cy="22" r="1" />
          <circle cx="16" cy="21" r="1" />
        </g>
      </>
    );
  else
    g = (
      <>
        <Cloud up />
        <path d="M12.5 17l-2.5 4h3l-1.5 3" stroke="var(--sun)" fill="none" />
      </>
    );
  const label = wxLabel(code);
  return (
    <svg
      className="wxi"
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {g}
    </svg>
  );
}

export function LevelIcon({ level }: { level: 0 | 1 | 2 }) {
  const d = ["M2 6.5 L5 9 L10 3", "M6 2 V7 M6 9.2 V10", "M3 3 L9 9 M9 3 L3 9"][level];
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
export const PlanIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4M12 13v5M9.5 15.5h5" />
  </svg>
);
export const GearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const ShareIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </svg>
);
export const EditIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
  </svg>
);
export const CalendarIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
export const DirectionsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
    <path d="M3 11l18-8-8 18-2-8z" />
  </svg>
);

const SPORT_PATHS: Record<Sport, ReactNode> = {
  ride: (
    <>
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <circle cx="15" cy="5" r="1.6" />
      <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
    </>
  ),
  run: (
    <>
      <circle cx="15" cy="4.5" r="1.8" />
      <path d="M5 11.5l3-3 4.5.5 2.5 3.5 3 1M12.5 9l-2 5 3.5 2.5V21M10.5 14l-2 3.5H5" />
    </>
  ),
  swim: (
    <>
      <circle cx="16" cy="7" r="2" />
      <path d="M5 12l5-3 3 3M2 16c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 20c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5" />
    </>
  ),
  pickleball: (
    <>
      <rect x="2.5" y="2" width="13" height="14" rx="5.5" transform="rotate(-35 9 9)" />
      <path d="M13.4 15.2l3.6 5" />
      <circle cx="19.5" cy="5.5" r="2.2" />
    </>
  ),
  ski: (
    <>
      <circle cx="15.5" cy="3.5" r="1.8" />
      <path d="M13 7.5L9 11l4 2-2 4.4M13 7.5l3 2.5 2.2 8.2M3 15l18 5.5" />
    </>
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth={2.6} />
    </>
  ),
};
export const SportIcon = ({ sport, size = 26 }: { sport: Sport; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke} strokeWidth={1.8}>
    {SPORT_PATHS[sport]}
  </svg>
);

export const Chevron = () => (
  <svg className="chev" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);
export const WindArrow = ({ deg }: { deg: number | null }) => (
  <svg
    className="arrow"
    viewBox="0 0 12 12"
    aria-hidden="true"
    style={{ transform: `rotate(${((deg ?? 0) + 180) % 360}deg)` }}
  >
    <path d="M6 1 L10 10 L6 8 L2 10 Z" fill="currentColor" />
  </svg>
);

// The brand logo: our own SVG, bundled at build time and inlined so it can use currentColor (white on the blue bar).
export const Logo = () => (
  <span
    className="logo-wrap"
    dangerouslySetInnerHTML={{ __html: logoSvg.replace("<svg ", '<svg class="logo" aria-hidden="true" ') }}
  />
);
