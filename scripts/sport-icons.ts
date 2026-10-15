// Copies the Material Symbols shapes listed in shared/sport-icons.ts into src/lib/icon-paths.ts. Run after changing
// the list:  npm pack @material-symbols/svg-400@0.48.0 && tar xzf material-symbols-svg-400-0.48.0.tgz
//            node scripts/sport-icons.ts package/rounded
// Material has no triathlon icon, so ours is put together from its swim, bike and run shapes (COMPOSED below).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ICON_KEYS, type Icon } from "../shared/sport-icons.ts";

/** Icons made of other Material shapes: [source, scale, x, y] in the 0 -960 960 960 box. */
const COMPOSED: Partial<Record<Icon, [string, number, number, number][]>> = {
  triathlon: [
    ["pool", 0.52, -10, -470], // swimmer, top left
    ["directions_run", 0.52, 470, -470], // runner, top right
    ["directions_bike", 0.52, 230, 10], // bike, bottom centre
  ],
};

/** Icons Material doesn't have, as finished shapes in its 0 -960 960 960 box and line weight. */
const DRAWN: Partial<Record<Icon, string>> = {
  // Tabler Icons "ping-pong" (MIT, brand/licenses/tabler-icons-LICENSE.txt): its 2-unit strokes turned into filled
  // outlines at Material's weight (about 62 of 960)
  ping_pong:
    "M708 -211L700 -182L691 -164L674 -140L652 -120L635 -109L618 -100L589 -92L570 -89L550 -89L531 -92L507 -99L476 -93L442 -89L412 -89L377 -93L342 -100L308 -110L276 -124L245 -142L220 -159L193 -182L173 -204L151 -231L132 -261L116 -293L106 -321L97 -355L91 -384L89 -420L90 -455L94 -485L102 -519L112 -547L126 -579L141 -605L158 -629L176 -652L219 -695L237 -712L260 -729L285 -745L311 -759L339 -770L367 -780L402 -787L437 -791L467 -791L502 -788L531 -782L565 -772L597 -760L679 -840L695 -853L710 -861L723 -866L736 -869L750 -871L765 -870L789 -866L803 -861L816 -854L828 -846L842 -832L851 -820L860 -806L867 -787L870 -770L871 -750L869 -736L865 -721L860 -708L847 -687L760 -597L769 -575L776 -553L782 -530L787 -507L790 -483L791 -459L791 -436L788 -412L785 -389L779 -366L772 -343L764 -321L753 -300L742 -279L729 -259L711 -236ZM728 -435L728 -473L723 -511L713 -548L692 -595L691 -608L696 -619L700 -624L794 -720L802 -731L808 -747L808 -763L803 -779L794 -793L780 -803L764 -808L747 -808L732 -802L721 -794L625 -701L621 -697L610 -693L598 -692L589 -694L549 -712L531 -718L507 -724L474 -728L435 -728ZM363 -713L325 -697L292 -676L266 -654L219 -607L199 -580L181 -551L168 -520L157 -483L153 -459L151 -430L152 -406L155 -377L160 -354L170 -326L181 -300L196 -275L210 -255L229 -234L250 -214L270 -199L290 -187L316 -174L343 -164L367 -157L400 -152L438 -151L429 -164L420 -182L412 -211L409 -240L412 -269L420 -298L434 -324L453 -347L468 -360L484 -371L511 -383L540 -390L570 -391L599 -386L627 -375L652 -360L674 -340L691 -315L703 -337L713 -363ZM646 -263L640 -279L631 -294L619 -307L604 -317L589 -324L572 -328L554 -329L537 -326L521 -320L506 -311L493 -299L483 -284L476 -269L472 -252L471 -234L474 -217L480 -201L489 -186L501 -173L516 -163L531 -156L548 -152L566 -151L583 -154L599 -160L614 -169L627 -181L637 -196L644 -211L648 -228L649 -246Z",
  // an 8-ball in a ring
  billiards:
    "M140 -480a340 340 0 1 0 680 0a340 340 0 1 0 -680 0ZM200 -480a280 280 0 1 1 560 0a280 280 0 1 1 -560 0ZM340 -490a140 140 0 1 0 280 0a140 140 0 1 0 -280 0ZM434 -548a46 46 0 1 1 92 0a46 46 0 1 1 -92 0ZM460 -548a20 20 0 1 0 40 0a20 20 0 1 0 -40 0ZM424 -446a56 56 0 1 1 112 0a56 56 0 1 1 -112 0ZM452 -446a28 28 0 1 0 56 0a28 28 0 1 0 -56 0Z",
  // a ball with three finger holes, and a pin
  bowling:
    "M100 -340a230 230 0 1 0 460 0a230 230 0 1 0 -460 0ZM160 -340a170 170 0 1 1 340 0a170 170 0 1 1 -340 0ZM252 -410a30 30 0 1 0 60 0a30 30 0 1 0 -60 0ZM332 -424a30 30 0 1 0 60 0a30 30 0 1 0 -60 0ZM288 -334a30 30 0 1 0 60 0a30 30 0 1 0 -60 0ZM720 -830C762 -830 786 -797 786 -760C786 -726 763 -706 754 -687C750 -659 778 -630 815 -574C852 -518 852 -444 834 -360C820 -294 806 -246 792 -210L648 -210C634 -246 620 -294 606 -360C588 -444 588 -518 625 -574C662 -630 690 -659 686 -687C677 -706 654 -726 654 -760C654 -797 678 -830 720 -830Z",
};

const ARGS: Record<string, number> = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };
const num = (n: number) => String(Math.round(n * 100) / 100);

/** Scales and moves an SVG path: absolute coordinates get scale and offset, relative ones only the scale. */
function movePath(d: string, k: number, dx: number, dy: number): string {
  const out: string[] = [];
  const re = /([MmLlTtHhVvCcSsQqAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g;
  const tokens = [...d.matchAll(re)].map((m) => m[0]);
  let i = 0;
  let first = true;
  while (i < tokens.length) {
    const cmd = tokens[i++] as string;
    const lower = cmd.toLowerCase();
    const n = ARGS[lower];
    if (n === undefined) throw new Error(`unexpected token ${cmd}`);
    out.push(cmd);
    if (n === 0) continue;
    let pairIndex = 0;
    do {
      const v = tokens.slice(i, i + n).map(Number);
      i += n;
      // A path's opening m is absolute; later pairs after it are relative line-tos.
      const abs = cmd === cmd.toUpperCase() || (lower === "m" && first && pairIndex === 0);
      const X = (x: number) => (abs ? x * k + dx : x * k);
      const Y = (y: number) => (abs ? y * k + dy : y * k);
      let w: number[];
      if (lower === "h") w = [X(v[0] as number)];
      else if (lower === "v") w = [Y(v[0] as number)];
      else if (lower === "a") {
        const [rx = 0, ry = 0, rot = 0, large = 0, sweep = 0, x = 0, y = 0] = v;
        w = [rx * k, ry * k, rot, large, sweep, X(x), Y(y)];
      } else w = v.map((x, j) => (j % 2 ? Y(x) : X(x)));
      if (lower === "m" && first && pairIndex === 0 && cmd === "m") out[out.length - 1] = "M";
      else if (lower === "m" && pairIndex > 0) out.push(cmd === "m" ? "l" : "L");
      else if (pairIndex > 0) out.push(" ");
      out.push(w.map(num).join(" "));
      pairIndex++;
    } while (i < tokens.length && !/[A-Za-z]/.test(tokens[i] as string));
    first = false;
  }
  return out.join("").replace(/ -/g, "-");
}

const dir = process.argv[2];
const read = (name: string) => {
  const svg = readFileSync(join(dir as string, `${name}.svg`), "utf8");
  if (!svg.includes('viewBox="0 -960 960 960"')) throw new Error(`${name}: unexpected viewBox`);
  const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1] as string);
  if (paths.length !== 1) throw new Error(`${name}: expected one path, found ${paths.length}`);
  return paths[0] as string;
};
if (import.meta.main) {
  if (!dir) throw new Error("usage: node scripts/sport-icons.ts <material-symbols>/rounded");
  const lines = ICON_KEYS.map((key) => {
    const parts = COMPOSED[key];
    const d =
      DRAWN[key] ?? (parts ? parts.map(([src, k, dx, dy]) => movePath(read(src), k, dx, dy)).join("") : read(key));
    return `  ${key}: "${d}",`;
  });
  writeFileSync(
    "src/lib/icon-paths.ts",
    `// Generated by scripts/sport-icons.ts from Google Material Symbols (Rounded, weight 400; Apache License 2.0,
// https://github.com/google/material-design-icons), plus the few drawn in scripts/sport-icons.ts (Ping-pong from Tabler
// Icons, MIT). Don't edit by hand. Shapes use viewBox "0 -960 960 960".
import type { Icon } from "../../shared/sport-icons.ts";

export const ICON_PATHS: Record<Icon, string> = {
${lines.join("\n")}
};
`,
  );
  console.log(`wrote ${lines.length} icons`);
}
