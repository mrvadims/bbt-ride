// Warnings as boxes (activity page) or chips (Home rows, Plan's place list), in the person's units.
import type { ReactNode } from "react";
import { fmtTime } from "../../shared/time.ts";
import { compass, type Warning } from "../../shared/weather.ts";
import type { Units } from "../lib/units.ts";
import { LevelIcon } from "./icons.tsx";

function warningText(w: Warning, u: Units, lookback: number): { short: string; title: string; detail: string } {
  switch (w.kind) {
    case "alert":
      return { short: w.event, title: w.event, detail: w.headline };
    case "lowLight":
      return {
        short: "Low light",
        title: "Low light at the start",
        detail: `Sunrise ${fmtTime(w.sunrise)}; bring front and rear lights`,
      };
    case "road": {
      const s = w.state.toLowerCase();
      const later = w.endState !== w.state ? `; ${w.endState.toLowerCase()} by the finish` : "";
      return {
        short: `Roads ${s}`,
        title: `Roads ${s} at meet time`,
        detail: `${u.rain(w.rainIn)} of rain in the last ${lookback} h${later}`,
      };
    }
    case "cold":
      return {
        short: `Cold ${u.temp(w.feel)}`,
        title: `Cold: ${w.feelName} down to ${u.temp(w.feel)}`,
        detail: w.kit ? "Dress for the start; see What to wear" : "Dress for the start",
      };
    case "heat":
      return {
        short: `Hot ${u.temp(w.app)}`,
        title: `Hot: real feel up to ${u.temp(w.app)}`,
        detail: "Bring extra water",
      };
    case "wind":
      return {
        short: `Wind ${u.speed(w.ws)}/${u.speed(w.wg)}`,
        title: `Windy: ${u.speed(w.ws)} ${u.speedUnit}, gusts ${u.speed(w.wg)}`,
        detail: `From the ${compass(w.dir)}`,
      };
    case "thunder":
      return { short: "Thunder", title: "Thunderstorms possible", detail: `${u.rain(w.rain)} expected` };
    case "rain":
      return {
        short: `Rain ${Math.round(w.pp)}%`,
        title: `Rain: ${Math.round(w.pp)}% chance`,
        detail: `${u.rain(w.rain)} expected`,
      };
  }
}

export function WarningBoxes({ list, u, lookback }: { list: Warning[]; u: Units; lookback: number }) {
  if (!list.length) return null;
  return (
    <section className="warns" aria-label="Warnings">
      {list.map((w) => {
        const t = warningText(w, u, lookback);
        return (
          <div key={t.title} className={`warn lv${w.level}`}>
            <LevelIcon level={w.level} />
            <div>
              <b>{t.title}</b>
              <span>{t.detail}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function Pill({ level, children }: { level: 0 | 1 | 2; children: ReactNode }) {
  return (
    <span className={`pill lv${level}`}>
      <LevelIcon level={level} />
      {children}
    </span>
  );
}

export function WarningChips({ list, u, lookback }: { list: Warning[]; u: Units; lookback: number }) {
  if (!list.length) return null;
  return (
    <span className="chips">
      {list.map((w) => {
        const t = warningText(w, u, lookback);
        return (
          <Pill key={t.short} level={w.level}>
            {t.short}
          </Pill>
        );
      })}
    </span>
  );
}
