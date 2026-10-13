-- v2: rides become activities of any sport (DESIGN.md → v2, Data model changes). Renaming a table keeps the foreign keys
-- that point at it, so RSVPs, messages and routes follow.
alter table rides rename to activities;
alter table activities rename column meet_time to start_time;
alter table activities add column sport text not null default 'ride'
  check (sport in ('ride', 'run', 'swim', 'pickleball', 'ski', 'other'));
alter table activities add column title text not null default '';
alter table activities add column end_time text;                  -- sports without a route; "HH:MM"
alter table activities add column outdoor integer not null default 1;
alter table activities add column details text not null default '';
-- pace_mph stays NOT NULL (changing that would mean rebuilding the table); sports without a pace store 0.

drop index rides_one_published_per_date;
drop index rides_date;
create unique index activities_one_published_per_sport_date on activities (date, sport) where status = 'published';
create index activities_date on activities (date);

alter table ride_routes rename to activity_routes;
alter table activity_routes rename column ride_id to activity_id;
alter table rsvps rename column ride_id to activity_id;
alter table messages rename column ride_id to activity_id;
drop index messages_ride;
create index messages_activity on messages (activity_id, created_at);

-- Warning thresholds are now grouped per weather group under one "warn" key; the old per-threshold rows go.
delete from settings where key in ('feelCaution', 'feelNoGo', 'heatCaution', 'heatNoGo', 'windCaution', 'windNoGo',
  'gustCaution', 'gustNoGo', 'rainProbCaution', 'rainProbNoGo', 'rainAmtCaution', 'rainAmtNoGo');
-- Drafts hold the old Plan form; they're short-lived autosaves.
delete from drafts;
