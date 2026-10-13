// Hourly table from the whole hour before the start to 3 h after the end; the activity window is shaded. The feel column
// (bike or run feel) shows for sports done on the move, the road column for rides.
import type { Settings } from "../../shared/settings.ts";
import type { Rules } from "../../shared/sports.ts";
import { fmtTime, nyNow } from "../../shared/time.ts";
import { bikeFeel, compass, type Evaluation, fIdx, roadAt, type Series } from "../../shared/weather.ts";
import type { Units } from "../lib/units.ts";
import { WindArrow, WxIcon } from "./icons.tsx";
import { Pill } from "./Warnings.tsx";

export function HourTable(props: { se: Series; ev: Evaluation; rules: Rules; feel?: string; s: Settings; u: Units }) {
  const { se, ev, rules, s, u } = props;
  const now = nyNow();
  const fn = fIdx(se, now.date, now.min);
  const rows = [];
  for (let i = Math.max(0, Math.floor(ev.f0) - 1); i <= Math.ceil(ev.f1) + 3; i++) {
    const T = se.T[i];
    if (T == null) continue;
    const road = roadAt(se, i, s);
    const inWindow = i >= Math.floor(ev.f0) && i <= ev.f1;
    const isNow = fn != null && Math.floor(fn) === i;
    rows.push(
      <tr key={i} className={`${inWindow ? "inwin" : ""} ${isNow ? "now" : ""}`}>
        <td>{fmtTime(Number(se.time[i]?.slice(11, 13)) * 60)}</td>
        <td className="sky">
          <WxIcon code={se.code[i]} day={se.day[i] !== 0} />
        </td>
        <td>{u.temp(T)}</td>
        <td>{u.temp(se.app[i])}</td>
        {props.feel && (
          <td>
            <b>{u.temp(bikeFeel(T, se.ws[i] ?? 0, se.app[i] ?? null, rules.pace))}</b>
          </td>
        )}
        <td>
          <WindArrow deg={se.wd[i] ?? null} /> {compass(se.wd[i] ?? 0)} {u.speed(se.ws[i])}
        </td>
        <td>{u.speed(se.wg[i])}</td>
        <td>{Math.round(se.pp[i] ?? 0)}%</td>
        <td>{u.rain(se.p[i] ?? 0)}</td>
        {rules.road && (
          <td>{road.level ? <Pill level={road.level}>{road.state}</Pill> : <span className="muted">Dry</span>}</td>
        )}
      </tr>,
    );
  }
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th className="sky">Sky</th>
            <th>Temp</th>
            <th>Real</th>
            {props.feel && <th>{props.feel}</th>}
            <th>Wind {u.speedUnit}</th>
            <th>Gust</th>
            <th>Rain</th>
            <th>Amt</th>
            {rules.road && <th>Road</th>}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
