// SVG charts: elevation profile, route outline (map fallback) and rain bars. Narrow viewBox on phones keeps labels legible.
import { FT_PER_M, M_PER_MI, type Route } from "../../shared/ride.ts";
import { nyNow } from "../../shared/time.ts";
import { fIdx, type Series } from "../../shared/weather.ts";
import type { Units } from "../lib/units.ts";

const chartW = () => (window.innerWidth < 600 ? 360 : 640);

export function ElevationChart({ route, stopMile, u }: { route: Route; stopMile: number | null; u: Units }) {
  const tr = route.track;
  const W = chartW();
  const H = W < 500 ? 150 : 130;
  const P = { l: 40, r: 8, t: 8, b: 20 };
  const metric = u.distUnit === "km";
  const toD = (m: number) => (metric ? m / 1000 : m / M_PER_MI);
  const toE = (m: number) => (metric ? m : m * FT_PER_M);
  const maxD = toD(tr[tr.length - 1]?.[3] ?? 1);
  const els = tr.map((p) => toE(p[2]));
  const lo = Math.min(...els);
  const hi = Math.max(...els);
  const span = Math.max(hi - lo, metric ? 30 : 100);
  const y0 = lo - span * 0.08;
  const y1 = hi + span * 0.08;
  const x = (d: number) => P.l + (d / maxD) * (W - P.l - P.r);
  const y = (e: number) => P.t + (1 - (e - y0) / (y1 - y0)) * (H - P.t - P.b);
  const line = tr.map((p, i) => `${i ? "L" : "M"}${x(toD(p[3])).toFixed(1)},${y(toE(p[2])).toFixed(1)}`).join("");
  const step = maxD > 45 ? 20 : maxD > 30 ? 10 : 5;
  const ticks: number[] = [];
  for (let d = 0; d <= maxD; d += step) if (x(d) < W - P.r - 22) ticks.push(d);
  const sm = stopMile == null ? null : u.mi(stopMile);
  const unit = metric ? "m" : "′";
  return (
    <svg
      className="profile"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Elevation profile from ${Math.round(lo)} to ${Math.round(hi)} ${metric ? "m" : "ft"}`}
    >
      <path d={`${line}L${x(maxD)},${H - P.b}L${P.l},${H - P.b}Z`} fill="var(--chart-soft)" />
      <path d={line} fill="none" stroke="var(--chart)" strokeWidth="1.6" />
      <text x={P.l - 4} y={y(hi) + 4} textAnchor="end">
        {Math.round(hi)}
        {unit}
      </text>
      <text x={P.l - 4} y={y(lo) + 4} textAnchor="end">
        {Math.round(lo)}
        {unit}
      </text>
      {ticks.map((d) => (
        <text key={d} x={x(d)} y={H - 5} textAnchor="middle">
          {d}
        </text>
      ))}
      {sm != null && (
        <>
          <line x1={x(sm)} x2={x(sm)} y1={P.t} y2={H - P.b} stroke="var(--muted)" strokeDasharray="3 3" />
          <text x={x(sm) + 4} y={P.t + 10}>
            stop
          </text>
        </>
      )}
      <text x={W - P.r} y={H - 5} textAnchor="end">
        {u.distUnit}
      </text>
    </svg>
  );
}

/** Route outline when the map can't load (offline or tiles blocked): equirectangular projection of the track. */
export function TrackOutline({ route, stop }: { route: Route; stop: { lat: number; lng: number } | null }) {
  const tr = route.track;
  const k = Math.cos(((tr[0]?.[0] ?? 0) * Math.PI) / 180);
  const xs = tr.map((p) => p[1] * k);
  const ys = tr.map((p) => p[0]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const W = 600;
  const H = 300;
  const s = Math.min((W - 40) / (x1 - x0 || 1), (H - 40) / (y1 - y0 || 1));
  const ox = (W - (x1 - x0) * s) / 2;
  const oy = (H - (y1 - y0) * s) / 2;
  const px = (la: number, ln: number): [number, number] => [ox + (ln * k - x0) * s, oy + (y1 - la) * s];
  const d = tr
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${px(p[0], p[1])
          .map((v) => v.toFixed(1))
          .join(",")}`,
    )
    .join("");
  const [sx, sy] = px(tr[0]?.[0] ?? 0, tr[0]?.[1] ?? 0);
  const stopAt = stop ? px(stop.lat, stop.lng) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Route outline">
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinejoin="round" />
      <circle cx={sx} cy={sy} r="7" fill="var(--primary)" stroke="#fff" strokeWidth="2" />
      {stopAt && (
        <circle cx={stopAt[0]} cy={stopAt[1]} r="6" fill="var(--card)" stroke="var(--chart)" strokeWidth="3" />
      )}
    </svg>
  );
}

/** Hourly rain from 12 h before to 8 h after roll-out; bars sit in the slot of the hour they end. */
export function RainBars({
  se,
  date,
  startMin,
  endMin,
  u,
}: {
  se: Series;
  date: string;
  startMin: number;
  endMin: number;
  u: Units;
}) {
  const fs = fIdx(se, date, startMin);
  if (fs == null) return null;
  const fe = fIdx(se, date, endMin) ?? fs;
  const i0 = Math.max(0, Math.floor(fs) - 12);
  const i1 = Math.min(se.time.length - 1, Math.floor(fs) + 8);
  const n = i1 - i0 + 1;
  const W = chartW();
  const H = W < 500 ? 190 : 150;
  const P = { l: 38, r: 8, t: 10, b: 22 };
  const bw = (W - P.l - P.r) / n;
  const maxP = Math.max(0.1, ...se.p.slice(i0, i1 + 1).map((v) => v ?? 0));
  const yh = H - P.t - P.b;
  // One time axis: time f (fractional hour index) is at the end of slot floor(f).
  const at = (f: number) => P.l + (f - i0) * bw + bw;
  const now = nyNow();
  const fn = fIdx(se, now.date, now.min);
  const bars = [];
  for (let i = i0; i <= i1; i++) {
    const pp = (se.pp[i] ?? 0) / 100;
    const pr = se.p[i] ?? 0;
    const bx = P.l + (i - i0) * bw + 2;
    const w = bw - 4;
    const hr = Number(se.time[i]?.slice(11, 13));
    bars.push(
      <g key={i}>
        <rect x={bx} y={P.t + yh * (1 - pp)} width={w} height={yh * pp} fill="var(--chart-soft)" />
        {pr > 0 && (
          <rect
            x={bx + w * 0.2}
            y={P.t + yh * (1 - pr / maxP)}
            width={w * 0.6}
            height={(yh * pr) / maxP}
            rx="1.5"
            fill="var(--chart)"
          />
        )}
        {hr % 3 === 0 && (
          <text x={at(i)} y={H - 6} textAnchor="middle">
            {hr % 12 || 12}
            {hr < 12 ? "a" : "p"}
          </text>
        )}
      </g>,
    );
  }
  return (
    <>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Hourly rain from 12 hours before to 8 hours after roll-out"
      >
        <rect
          x={at(fs)}
          y={P.t}
          width={Math.max(2, at(fe) - at(fs))}
          height={yh}
          fill="var(--win)"
          stroke="var(--win-line)"
          strokeDasharray="4 3"
        />
        <text
          x={(at(fs) + at(fe)) / 2}
          y={P.t + 12}
          textAnchor="middle"
          style={{ fill: "var(--win-line)", fontWeight: 700 }}
        >
          ride
        </text>
        {bars}
        {fn != null && fn >= i0 - 1 && fn <= i1 && (
          <>
            <line x1={at(fn)} x2={at(fn)} y1={P.t} y2={H - P.b} stroke="var(--text)" strokeWidth="1.5" />
            <text x={at(fn) + 3} y={H - P.b - 4} style={{ fill: "var(--text)" }}>
              now
            </text>
          </>
        )}
        <line x1={P.l} x2={W - P.r} y1={H - P.b} y2={H - P.b} stroke="var(--line)" />
        <text x={P.l - 4} y={P.t + 8} textAnchor="end">
          {u.rain(maxP)}
        </text>
        <text x={P.l - 4} y={H - P.b} textAnchor="end">
          0
        </text>
      </svg>
      <div className="legend">
        <span>
          <i style={{ background: "var(--chart)" }} />
          Rain per hour
        </span>
        <span>
          <i style={{ background: "var(--chart-soft)" }} />
          Chance
        </span>
        <span>
          <i style={{ background: "var(--win)", outline: "1px dashed var(--win-line)" }} />
          Ride window
        </span>
      </div>
    </>
  );
}
