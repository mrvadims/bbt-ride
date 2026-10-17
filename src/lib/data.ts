// Server data via TanStack Query: cached per endpoint, refetched when stale.
import { keepPreviousData, QueryClient, useQuery } from "@tanstack/react-query";
import type {
  Activity,
  ActivityDetail,
  Announcement,
  Me,
  PollDetail,
  PollSummary,
  RouteSummary,
  TeamMember,
  TeamSettings,
  WeatherData,
} from "../../shared/api.ts";
import type { Route, Spot } from "../../shared/ride.ts";
import { type Series, toSeries } from "../../shared/weather.ts";
import { ApiError, api } from "./api.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

export type SpotWithState = Spot & { archived: boolean };

export const useMe = () =>
  useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me"), retry: false, staleTime: 5 * 60_000 });
/** Announcements for the banner and the Announcements page; checked again every 10 minutes while the app is open. */
export const useAnnouncements = () =>
  useQuery({
    queryKey: ["announcements"],
    queryFn: () => api<Announcement[]>("/announcements"),
    refetchInterval: 10 * 60_000,
  });
export const useTeamSettings = () =>
  useQuery({ queryKey: ["settings"], queryFn: () => api<TeamSettings>("/settings") });
/** The team directory (Team page, contact cards, @mentions). */
export const useMembers = () => useQuery({ queryKey: ["members"], queryFn: () => api<TeamMember[]>("/team") });
/** After adding or changing a spot: the list and the forecast (which covers each active spot). */
export const refreshSpots = (qc: QueryClient) =>
  Promise.all([qc.invalidateQueries({ queryKey: ["spots"] }), qc.invalidateQueries({ queryKey: ["weather"] })]);
export const useSpots = () => useQuery({ queryKey: ["spots"], queryFn: () => api<SpotWithState[]>("/spots") });
export const useActivities = () =>
  useQuery({ queryKey: ["activities"], queryFn: () => api<Activity[]>("/activities") });
export const usePast = () =>
  useQuery({ queryKey: ["activities", "past"], queryFn: () => api<Activity[]>("/activities/past") });

/** One activity with RSVPs and messages; refreshed every 30 s while the page is open (DESIGN.md → v2, Activity page). */
export const useActivity = (id: string | null | undefined) =>
  useQuery({
    queryKey: ["activity", id],
    queryFn: () => api<ActivityDetail>(`/activities/${id}`),
    enabled: Boolean(id),
    refetchInterval: 30_000,
    refetchOnMount: "always", // opening it shows what's new since, not a copy from earlier
  });

/** Date polls the viewer is asked on (Home, the poll list); a poll with its answers, refreshed every 30 s while open. */
export const usePolls = () => useQuery({ queryKey: ["polls"], queryFn: () => api<PollSummary[]>("/polls") });
export const usePoll = (id: string | null | undefined) =>
  useQuery({
    queryKey: ["poll", id],
    queryFn: () => api<PollDetail>(`/polls/${id}`),
    enabled: Boolean(id),
    refetchInterval: 30_000,
    refetchOnMount: "always",
  });

export const useRoute = (id: number | null | undefined) =>
  useQuery({
    queryKey: ["route", id],
    queryFn: () => api<Route>(`/routes/${id}`),
    enabled: Boolean(id),
    staleTime: 24 * 3600_000,
  });

export const useRouteSearch = (q: string) =>
  useQuery({
    queryKey: ["routes", q],
    queryFn: () => api<RouteSummary[]>(`/routes?q=${encodeURIComponent(q)}`),
    placeholderData: keepPreviousData,
  });

interface Weather {
  series: Record<string, Series>;
  alerts: WeatherData["alerts"];
}
export const NO_WEATHER: Weather = { series: {}, alerts: {} };
export const useWeather = () =>
  useQuery({
    queryKey: ["weather"],
    queryFn: async (): Promise<Weather> => {
      const w = await api<WeatherData>("/weather");
      return {
        alerts: w.alerts,
        series: Object.fromEntries(Object.entries(w.forecast).map(([id, om]) => [id, toSeries(om)])),
      };
    },
    staleTime: 10 * 60_000,
  });
