// Sport icons (DESIGN.md → v2, Sport icons): Google Material Symbols, Rounded, weight 400 (Apache 2.0). Each sport has its own
// icon; an Other activity can show any icon from ICONS instead (picked in Plan). The shapes are copied into
// src/lib/icon-paths.ts by scripts/sport-icons.ts, which also holds the few Material lacks (Triathlon, put together from
// its swim, bike and run shapes; Ping-pong, from Tabler Icons, MIT; Billiards and Bowling, drawn to match); nothing
// loads from outside.
import type { Sport } from "./sports.ts";

/** The icons an Other activity can show, in picker order, with what each stands for. */
export const ICONS = {
  pending: "Other",
  hiking: "Hike",
  directions_walk: "Walk",
  nordic_walking: "Nordic walk",
  mountain_flag: "Climb",
  directions_bike: "Ride",
  directions_run: "Run",
  pool: "Swim",
  triathlon: "Triathlon",
  kayaking: "Kayak",
  rowing: "Row",
  sailing: "Sail",
  surfing: "Surf",
  kitesurfing: "Kitesurf",
  scuba_diving: "Dive",
  downhill_skiing: "Ski",
  snowboarding: "Snowboard",
  snowshoeing: "Snowshoe",
  sledding: "Sled",
  ice_skating: "Skate",
  roller_skating: "Roller skate",
  skateboarding: "Skateboard",
  pickleball: "Pickleball",
  sports_tennis: "Tennis",
  sports_golf: "Golf",
  sports_soccer: "Soccer",
  sports_basketball: "Basketball",
  sports_volleyball: "Volleyball",
  sports_baseball: "Baseball",
  sports_football: "Football",
  sports_hockey: "Hockey",
  sports_martial_arts: "Martial arts",
  sports_gymnastics: "Gymnastics",
  self_improvement: "Yoga",
  fitness_center: "Gym",
  paragliding: "Paraglide",
  chess_knight: "Chess",
  playing_cards: "Cards",
  ping_pong: "Ping-pong",
  billiards: "Billiards",
  bowling: "Bowling",
  restaurant: "Meal",
  sports_bar: "Drinks",
  celebration: "Party",
  groups: "Meetup",
  volunteer_activism: "Volunteer",
} as const;
export type Icon = keyof typeof ICONS;
export const ICON_KEYS = Object.keys(ICONS) as [Icon, ...Icon[]];

/** Each sport's icon; Other's is a circle with three dots until an editor picks another. */
export const SPORT_ICON: Record<Sport, Icon> = {
  ride: "directions_bike",
  run: "directions_run",
  swim: "pool",
  triathlon: "triathlon",
  pickleball: "pickleball",
  ski: "downhill_skiing",
  other: "pending",
};

/** The icon an activity shows: its own pick (Other only), else its sport's. */
export const activityIcon = (a: { sport: Sport; icon?: Icon | null }): Icon =>
  (a.sport === "other" && a.icon) || SPORT_ICON[a.sport];
