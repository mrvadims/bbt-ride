// What's new (DESIGN.md → Updates): dated release notes for members, inside the app so only signed-in members see them.
// /updates lists them, newest first; /updates/<date> is one, the link to send or put in an announcement. Add new ones at
// the top of UPDATES.
import type { ReactNode } from "react";
import { Link } from "../lib/router.tsx";

interface Update {
  date: string; // YYYY-MM-DD, also its address
  label: string; // "October 15, 2026"
  title: string;
  summary: string;
  sections: { h: string; items: ReactNode[] }[];
  note?: ReactNode;
}

const UPDATES: Update[] = [
  {
    date: "2026-10-17",
    label: "October 17, 2026",
    title: "Messages panel, date polls, message notifications and @here",
    summary: "Plus a few smaller improvements.",
    sections: [
      {
        h: "Messages panel and a more compact activity page",
        items: [
          <>
            <b>Messages</b> are now their own panel, under Who's in, open by default. Closed, it shows how many messages
            there are, how many are new and the latest one.
          </>,
          <>
            Every panel closes to a single line, so with all of them closed an activity fits on one phone screen. The
            Route, Weather and Who's in headers show the key facts at a glance.
          </>,
        ],
      },
      {
        h: "Date polls",
        items: [
          <>
            Editors: <b>Plan → Date poll</b> asks which day or weekend works. Pick up to 14 options within a year, and
            make it <b>Public or Private</b>, like an activity.
          </>,
          <>
            Everyone asked answers <b>In, Maybe or Out</b> for each date, with an optional note. Polls waiting for you
            are at the top of Home.
          </>,
          <>
            The best date comes first. <b>Plan this</b> turns it into an activity and tells the people who said In or
            Maybe.
          </>,
          <>Each poll has its own Messages. All of them are under All date polls on Home.</>,
        ],
      },
      {
        h: "Message notifications",
        items: [
          <>
            New messages now <b>notify</b> the people In (on a poll, In or Maybe), whoever created it and anyone who
            posted. Before, only @mentions did.
          </>,
          <>Several messages in a row update one notification until you open the thread.</>,
          <>
            <b>Notify me about new messages</b>, under each thread, turns them off for that thread, or on for one you're
            not part of.
          </>,
          <>
            Type <b>@here</b> to notify everyone who can see the activity or poll.
          </>,
        ],
      },
      {
        h: "Smaller improvements",
        items: [
          <>
            The <b>calendar link</b> now keeps the last 30 days of activities you were In for, not 14.
          </>,
          <>
            The <b>Team</b> list no longer shows roles.
          </>,
        ],
      },
    ],
    note: (
      <>
        <b>Android:</b> update the app when it offers (version 1.3) so a thread's notifications stay on one card and
        tapping one about a date poll opens it. The iPhone Home Screen app and browsers need no update.
      </>
    ),
  },
  {
    date: "2026-10-15",
    label: "October 15, 2026",
    title: "Private activities, announcements and Zoom meet-ups",
    summary: "Plus a user guide, Garmin help, What's new, new icons for Other and a few smaller improvements.",
    sections: [
      {
        h: "Private activities",
        items: [
          <>
            Plan now has <b>Visibility: Public or Private</b>. A private activity is seen only by the people invited.
            Admins who weren't invited don't see it either.
          </>,
          <>
            People invited are <b>notified</b>, even if they've turned off that sport's notifications.
          </>,
          <>
            <b>Invited Editors</b> can edit the activity and its guest list. <b>Invited Members</b> can answer In or Out
            and post messages.
          </>,
          <>
            People removed from the guest list lose access, along with their In or Out answer. A private activity can be{" "}
            <b>made public</b>, but a public one can't be made private.
          </>,
          <>
            A small <b>lock</b> sits on a private activity's icon. Who's in lists who hasn't answered yet, and @mentions
            only offer the people invited.
          </>,
        ],
      },
      {
        h: "Deleting activities",
        items: [
          <>
            You can now <b>delete activities you created</b>. Before, only Admins could.
          </>,
        ],
      },
      {
        h: "Announcements",
        items: [
          <>
            Admins post team announcements from <b>Settings → Announcements</b>, with an optional end date and an
            optional notification. Each one shows how many people tapped Got it, and who hasn't yet.
          </>,
          <>
            An announcement shows as a <b>banner</b> on every page until you tap <b>Got it</b>, including for the person
            who posted it. Dismissing it on one device clears it on all of them.
          </>,
          <>
            Read recent ones again in the account menu under <b>Announcements</b>.
          </>,
        ],
      },
      {
        h: "Virtual meet-ups",
        items: [
          <>
            A place can now be a <b>meeting link</b> (Zoom, Google Meet, Teams or any https link) instead of a map pin.
          </>,
          <>
            <b>Any sport can be online.</b> It uses start and end times, the route is optional for rides and runs, and
            there's no pace or weather.
          </>,
          <>
            A <b>Join</b> button replaces Directions and opens the Zoom or Meet app if it's installed. Calendar events
            use the meeting link as the location.
          </>,
        ],
      },
      {
        h: "Help and What's new",
        items: [
          <>
            <b>Help → Using BBT</b>: a quick guide to everything the app does, with a button to go and do each thing.
          </>,
          <>
            <b>Help → Routes on your Garmin</b>: one-time setup, sending a ride's route, a checklist for when a route
            doesn't arrive, and copying a route over by cable.
          </>,
          <>
            <b>What's new</b> in the account menu: these release notes, each at its own link to share.
          </>,
        ],
      },
      {
        h: "Smaller improvements",
        items: [
          <>
            <b>New icons</b> for Other activities: chess, cards, ping-pong, billiards and bowling.
          </>,
          <>
            <b>Multi-part emoji</b> in names (families, flags, skin tones) are no longer broken up.
          </>,
          <>
            On iPhone, the <b>time fields in Plan</b> now stay inside their column.
          </>,
        ],
      },
    ],
    note: (
      <>
        <b>No update needed:</b> the Android app and the iPhone Home Screen app pick up these changes the next time you
        open them.
      </>
    ),
  },
];

export function UpdatesPage({ date }: { date?: string }) {
  const u = date ? UPDATES.find((x) => x.date === date) : undefined;
  if (date && !u)
    return (
      <section className="panel empty">
        <p>
          <b>No update for that date.</b>
        </p>
        <Link href="/updates">All updates</Link>
      </section>
    );
  if (u)
    return (
      <section className="help updates">
        <div>
          <div className="kicker">
            <time dateTime={u.date}>{u.label}</time>
          </div>
          <h1>What's new in BBT</h1>
          <p className="muted small">
            {u.title}. {u.summary}
          </p>
        </div>
        {u.sections.map((s) => (
          <div key={s.h} className="panel help-sec">
            <h2>{s.h}</h2>
            <ul>
              {s.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
        {u.note && <p className="notice small">{u.note}</p>}
        <Link href="/updates">All updates</Link>
      </section>
    );
  return (
    <section className="help updates">
      <div>
        <div className="kicker">BBT</div>
        <h1>What's new</h1>
      </div>
      {UPDATES.map((x) => (
        <Link key={x.date} className="panel update-row" href={`/updates/${x.date}`}>
          <span className="kicker">
            <time dateTime={x.date}>{x.label}</time>
          </span>
          <b>{x.title}</b>
          <span className="small muted">{x.summary}</span>
        </Link>
      ))}
    </section>
  );
}
