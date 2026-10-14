// Server data via TanStack Query: cached per endpoint, refetched when stale.
import { keepPreviousData, QueryClient, useQuery } from "@tanstack/react-query";
import type {
  Activity,
  ActivityDetail,
  Me,
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
export const useTeam = () => useQuery({ queryKey: ["settings"], queryFn: () => api<TeamSettings>("/settings") });
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

/** One activity with RSVPs and messages; refreshed every 30 s while the page is open (DESIGN.md → v1 scope → Rides, Who's in). */
export const useActivity = (id: string | null | undefined) =>
  useQuery({
    queryKey: ["activity", id],
    queryFn: () => api<ActivityDetail>(`/activities/${id}`),
    enabled: Boolean(id),
    refetchInterval: 30_000,
    refetchOnMount: "always", // each open records the visit (New and unread markers)
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

export interface Weather {
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
