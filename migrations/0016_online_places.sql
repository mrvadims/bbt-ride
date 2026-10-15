-- Online places (DESIGN.md → v2, Virtual meet-ups): a place can be a meeting link (Zoom, Google Meet, Teams, …) instead
-- of a pin. An online place keeps its link in maps_url, has no coordinates (lat/lng 0) and gets no forecast.
alter table spots add column online integer not null default 0;
