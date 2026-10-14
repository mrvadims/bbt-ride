// JSON shapes exchanged between the Worker (/api/*) and the React app, plus request schemas the Worker validates.
import { z } from "zod";
import type { KitBand } from "./kit.ts";
import type { RideRoute } from "./ride.ts";
import { HHMM, type Settings } from "./settings.ts";
import { ICON_KEYS, type Icon } from "./sport-icons.ts";
import { canBeIndoor, hasRoute, PACE_RANGE, SPORT_LABEL, SPORTS, type Sport } from "./sports.ts";
import { hhmmToMin } from "./time.ts";
import type { Alert, OpenMeteoResponse } from "./weather.ts";

export const ROLES = ["view", "edit", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABEL: Record<Role, string> = { view: "View", edit: "Edit", admin: "Admin" };

export interface Me {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: Role;
  methods: ("google" | "password")[];
  vapidPublicKey: string;
  mutedSports: Sport[]; // no "new activity" notifications for these
  calendarUrl: string | null; // the private calendar link, once made
}

export interface TeamSettings {
  settings: Settings;
  kit: KitBand[];
}

export interface WeatherData {
  forecast: Record<string, OpenMeteoResponse>; // by spot id
  alerts: Record<string, Alert[]>;
}

export interface RecordedWeather {
  T: number;
  app: number;
  ws: number;
  wg: number;
  rain: number; // inches in the look-back window before the start
  road: "Dry" | "Drying" | "Wet";
  code: number;
}

export interface Activity {
  id: string;
  sport: Sport;
  icon: Icon | null; // Other only: the icon an editor picked; null shows the sport's icon
  title: string; // empty: the route's name (ride, run) or the sport's name
  date: string;
  startTime: string; // "08:30"; the meet time for ride and run
  endTime: string | null; // sports without a route; ride and run end when the route says
  spotId: string;
  outdoor: boolean; // false: indoors, no weather check
  pace: number; // mph for ride and run (a run shows min/mi); 0 for other sports
  details: string; // one short line, e.g. "2 courts"
  notes: string;
  status: "published" | "cancelled";
  updatedAt: string; // sent back with an update, so a change made meanwhile isn't overwritten
  routes: (RideRoute & { name: string | null })[]; // name from the route cache
  lastUpdate: { at: string; text: string } | null;
  counts: { in: number; out: number; messages: number };
  mine?: "in" | "out" | null; // the viewer's own answer (the upcoming list only)
  observed: RecordedWeather | null;
}

export interface Message {
  id: string;
  parentId: string | null;
  kind: "user" | "update" | "cancel" | "restore";
  authorId: string | null;
  authorName: string | null; // null with kind "user" = former member
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
}

export interface Rsvp {
  userId: string;
  name: string;
  status: "in" | "out";
  routeLabel: string | null;
}

export interface ActivityDetail extends Activity {
  rsvps: Rsvp[];
  messages: Message[];
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: Role;
  disabled: boolean;
  methods: ("google" | "password")[];
}
export interface Invite {
  email: string;
  role: Role;
  expiresAt: string;
}

export interface RouteSummary {
  id: number;
  name: string;
  distance_m: number;
  elevation_gain_m: number;
  start: [number, number]; // lat, lng of the first track point
}

// ---- request schemas ----
const date = z.iso.date(); // a real calendar date, YYYY-MM-DD
const hhmm = z.string().regex(HHMM);

const activityFields = z.object({
  sport: z.enum(SPORTS),
  icon: z.enum(ICON_KEYS).nullable().default(null),
  title: z.string().trim().max(60).default(""),
  date,
  startTime: hhmm,
  endTime: hhmm.nullable().default(null),
  spotId: z.string().min(1).max(80),
  outdoor: z.boolean().default(true),
  pace: z.number().min(0).max(25).default(0),
  details: z.string().trim().max(80).default(""),
  notes: z.string().max(4000),
  routes: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(30),
        routeId: z.number().int().positive(),
        stop: z.string().max(200).nullable(),
      }),
    )
    .max(2)
    .refine((r) => new Set(r.map((x) => x.label.toLowerCase())).size === r.length, "Route labels must differ")
    .default([]),
  replace: z.boolean().default(false), // confirm replacing the same sport's activity already published that day
});
type ActivityFields = z.output<typeof activityFields>;

/** Ride and run need a route and a pace in range; other sports an end time after the start and no route. */
function checkSport(a: ActivityFields, ctx: z.RefinementCtx) {
  if (a.sport === "ride" || a.sport === "run") {
    const [lo, hi] = PACE_RANGE[a.sport];
    if (!a.routes.length) ctx.addIssue({ code: "custom", message: "Pick a route", path: ["routes"] });
    if (a.pace < lo || a.pace > hi) ctx.addIssue({ code: "custom", message: "Pace is out of range", path: ["pace"] });
  } else {
    if (a.routes.length) ctx.addIssue({ code: "custom", message: "Only rides and runs have routes", path: ["routes"] });
    if (!a.endTime || hhmmToMin(a.endTime) <= hhmmToMin(a.startTime))
      ctx.addIssue({ code: "custom", message: "The end time must be after the start", path: ["endTime"] });
  }
}
/** Fields that don't apply to the sport are stored empty. */
const normalize = <T extends ActivityFields>(a: T): T => ({
  ...a,
  icon: a.sport === "other" && a.icon !== "pending" ? a.icon : null,
  endTime: hasRoute(a.sport) ? null : a.endTime,
  pace: hasRoute(a.sport) ? a.pace : 0,
  details: hasRoute(a.sport) ? "" : a.details,
  outdoor: canBeIndoor(a.sport) ? a.outdoor : true,
});

export const activityInput = activityFields.superRefine(checkSport).transform(normalize);
export type ActivityValues = z.output<typeof activityInput>;
// An update also sends the activity's updatedAt from when the editor opened it, so a later change isn't overwritten.
export const activityUpdate = activityFields
  .extend({ baseUpdatedAt: z.string().max(40) })
  .superRefine(checkSport)
  .transform(normalize);
export type ActivityUpdate = z.input<typeof activityUpdate>;

/** The name people see: the title, else the route's name (ride, run), else the sport. */
export const activityName = (a: Pick<Activity, "title" | "sport" | "routes">): string =>
  a.title || (hasRoute(a.sport) ? a.routes[0]?.name : null) || SPORT_LABEL[a.sport];

export const rsvpInput = z.object({
  status: z.enum(["in", "out"]).nullable(),
  routeLabel: z.string().max(30).nullable(),
});
export const messageInput = z.object({
  body: z.string().trim().min(1).max(2000),
  parentId: z.string().max(64).nullable().default(null),
});
export const messageEdit = z.object({ body: z.string().trim().min(1).max(2000) });

export const spotInput = z.object({
  name: z.string().trim().min(1).max(80),
  link: z.string().trim().min(1).max(2000), // Google Maps link or "lat, lng"
  note: z.string().trim().max(1000), // parking, entrance… (optional)
});
export const spotEdit = spotInput.partial().extend({ archived: z.boolean().optional() });

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  role: z.enum(ROLES),
});
export const userEdit = z.object({
  role: z.enum(ROLES).optional(),
  disabled: z.boolean().optional(),
});
export const mutedChange = z.object({ off: z.boolean() }); // PUT /api/me/muted/:sport

// Link tokens travel in request bodies, never in API URLs (which end up in request logs).
export const linkToken = z.object({ token: z.string().min(8).max(100) });
export const linkAccept = linkToken.extend({
  name: z.string().trim().min(1).max(80).optional(), // invite only
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,30}$/, "3–30 letters, digits, dots or underscores")
    .optional(),
  password: z.string().min(10).max(128),
});
// Browsers' push services, and only those (the Worker sends signed requests to these hosts): Google (Chrome, Android:
// fcm.googleapis.com, jmt<N>.google.com), Mozilla (Firefox), Apple (Safari, iOS) and Microsoft (Edge).
const PUSH_HOSTS =
  /^(fcm\.googleapis\.com|jmt\d+\.google\.com|([a-z0-9-]+\.)?push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
/** The Android app's Firebase registration token. */
export const appPushToken = z.object({ token: z.string().regex(/^[\w:-]{20,1024}$/, "Not a Firebase token") });
export const pushSubscription = z.object({
  endpoint: z.url({ protocol: /^https$/, hostname: PUSH_HOSTS, error: "Not a browser push service" }).max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
