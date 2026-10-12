// JSON shapes exchanged between the Worker (/api/*) and the React app, plus request schemas the Worker validates.
import { z } from "zod";
import type { KitBand } from "./kit.ts";
import type { RideRoute, Spot } from "./ride.ts";
import type { Settings } from "./settings.ts";
import type { Alert, OpenMeteoResponse } from "./weather.ts";

export type Role = "view" | "edit" | "admin";

export interface Me {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: Role;
  methods: ("google" | "password")[];
  vapidPublicKey: string;
}

export interface TeamSettings {
  settings: Settings;
  kit: KitBand[];
}

export interface WeatherData {
  fetchedAt: string;
  forecast: Record<string, OpenMeteoResponse>; // by spot id
  alerts: Record<string, Alert[]>;
}

export interface RecordedWeather {
  T: number;
  app: number;
  ws: number;
  wg: number;
  rain: number; // inches in the 12 h before roll-out
  road: "Dry" | "Drying" | "Wet";
  code: number;
}

export interface RideSummary {
  id: string;
  date: string;
  rollout: string;
  spotId: string;
  pace: number;
  notes: string;
  status: "published" | "cancelled";
  routes: (RideRoute & { name: string | null })[]; // name from the route cache
  lastUpdate: { at: string; text: string } | null;
  counts: { in: number; out: number; messages: number };
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

export interface RideDetail extends RideSummary {
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

export type { Spot };

// ---- request schemas ----
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const rideInput = z.object({
  date,
  rollout: hhmm,
  spotId: z.string().min(1).max(80),
  pace: z.number().min(10).max(25),
  notes: z.string().max(4000),
  routes: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(30),
        routeId: z.number().int().positive(),
        stop: z.string().max(200).nullable(),
      }),
    )
    .min(1)
    .max(2)
    .refine((r) => new Set(r.map((x) => x.label.toLowerCase())).size === r.length, "Route labels must differ"),
  replace: z.boolean().default(false), // confirm replacing a ride already published on that date
});
export type RideInput = z.input<typeof rideInput>;

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
  note: z.string().trim().max(1000),
});
export const spotEdit = spotInput.partial().extend({ archived: z.boolean().optional() });

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(["view", "edit", "admin"]),
});
export const userEdit = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  role: z.enum(["view", "edit", "admin"]).optional(),
  disabled: z.boolean().optional(),
});
export const linkAccept = z.object({
  name: z.string().trim().min(1).max(80).optional(), // invite only
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_.]{3,30}$/, "3–30 letters, digits, dots or underscores")
    .optional(),
  password: z.string().min(10).max(128),
});
// Browsers' push services (Chrome/Android, Firefox, Safari/iOS, Edge).
const PUSH_HOSTS =
  /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
export const pushSubscription = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => {
      const url = new URL(u);
      return url.protocol === "https:" && PUSH_HOSTS.test(url.hostname);
    }, "Not a browser push service"),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});
