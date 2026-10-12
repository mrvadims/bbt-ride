// Collapsible panels: the collapsed header is the briefing; expanding shows detail. Open state is remembered per rider.
import type { ReactNode } from "react";
import { setPref, usePrefs } from "../lib/prefs.ts";
import { Chevron } from "./icons.tsx";

const wide = () => window.matchMedia("(min-width: 960px)").matches;

export function Panel(props: {
  id: string;
  label: string;
  summary: ReactNode;
  children: ReactNode;
  collapsed?: boolean; // start closed even on desktop
  titled?: boolean; // label shown as a title (long names) instead of a small caps tag
}) {
  const { panels } = usePrefs();
  const open = panels[props.id] ?? (props.collapsed ? false : wide());
  const toggle = () => setPref("panels", { ...panels, [props.id]: !open });
  return (
    <section className={`panel${props.titled ? " titled" : ""}`}>
      {/* The whole header toggles; the button carries the accessible state. Links and controls inside the summary keep working. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the button inside handles keyboard use */}
      <div
        className="panel-h"
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("a, .seg, button:not(.panel-t), input, select")) toggle();
        }}
      >
        <button type="button" className="panel-t" aria-expanded={open} aria-controls={`pb-${props.id}`}>
          {props.label}
        </button>
        <div className="panel-s">{props.summary}</div>
        <Chevron />
      </div>
      <div className="panel-b" id={`pb-${props.id}`} hidden={!open}>
        {open && props.children}
      </div>
    </section>
  );
}

/** A non-collapsing panel for forms. */
export const Section = ({ label, children }: { label: string; children: ReactNode }) => (
  <section className="panel">
    <div className="sec-h">{label}</div>
    <div className="sec-b">{children}</div>
  </section>
);

/** A header-only panel with a short message (e.g. no forecast yet). */
export const EmptyPanel = ({ label, text }: { label: string; text: string }) => (
  <section className="panel">
    <div className="panel-h">
      <span className="panel-t">{label}</span>
      <div className="panel-s muted">{text}</div>
    </div>
  </section>
);
