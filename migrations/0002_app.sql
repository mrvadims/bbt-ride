-- App tables (DESIGN.md → Data model). Dates are ISO strings; ride dates are New York "YYYY-MM-DD".
-- D1 enforces foreign keys: references to a user cascade or become NULL when the user is deleted.

create table spots (
  id text primary key,
  name text not null unique collate nocase,
  lat real not null,
  lng real not null,
  maps_url text not null,
  note text not null default '',
  archived integer not null default 0,
  created_at text not null
);

create table rides (
  id text primary key,
  date text not null,
  rollout text not null,                       -- "08:30"
  spot_id text not null references spots (id),
  pace_mph real not null,
  notes text not null default '',
  observed_json text,                          -- recorded weather, saved after the ride window
  status text not null check (status in ('published', 'cancelled')),
  created_by text references "user" (id) on delete set null,
  updated_by text references "user" (id) on delete set null,
  created_at text not null,
  updated_at text not null
);
create unique index rides_one_published_per_date on rides (date) where status = 'published';
create index rides_date on rides (date);

create table ride_routes (
  ride_id text not null references rides (id) on delete cascade,
  sort integer not null,
  label text not null,                         -- "Main", or e.g. "Full" / "Short"
  rwgps_route_id integer not null,
  stop_poi text,                               -- name of the coffee-stop POI on that route
  primary key (ride_id, sort)
);

create table route_cache (
  rwgps_route_id integer primary key,
  name text,
  json text,                                   -- simplified route (shared/ride.ts Route); NULL until fetched
  in_library integer not null default 0,       -- listed in route search (captain's and club library)
  fetched_at text
);

create table drafts (
  user_id text primary key references "user" (id) on delete cascade,
  ride_id text references rides (id) on delete set null,
  form_json text not null,
  updated_at text not null
);

create table rsvps (
  ride_id text not null references rides (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  status text not null check (status in ('in', 'out')),
  route_label text,
  updated_at text not null,
  primary key (ride_id, user_id)
);

create table messages (
  id text primary key,
  ride_id text not null references rides (id) on delete cascade,
  user_id text references "user" (id) on delete set null,
  parent_id text references messages (id) on delete cascade,
  kind text not null default 'user' check (kind in ('user', 'update', 'cancel', 'restore')),
  body text not null,
  created_at text not null,
  edited_at text,
  deleted_at text
);
create index messages_ride on messages (ride_id, created_at);

create table push_subscriptions (
  endpoint text primary key,
  user_id text not null references "user" (id) on delete cascade,
  keys_json text not null,
  created_at text not null
);

create table links (
  token_hash text primary key,                 -- SHA-256 of the token; the token itself is never stored
  kind text not null check (kind in ('invite', 'reset')),
  email text not null,
  role text check (role in ('view', 'edit', 'admin')),
  user_id text references "user" (id) on delete cascade,
  created_by text references "user" (id) on delete set null,
  created_at text not null,
  expires_at text not null,
  used_at text
);
create index links_email on links (email);

create table settings (
  key text primary key,
  value_json text not null,
  updated_by text references "user" (id) on delete set null,
  updated_at text not null
);

create table kit_bands (
  id integer primary key,
  min_feel_f real not null,
  name text not null,
  items_json text not null,
  sort integer not null
);

create table audit_log (
  id integer primary key,
  user_id text references "user" (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  diff_json text,
  at text not null
);
