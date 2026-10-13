-- v2 step 2 (DESIGN.md → v2, Calendar link and Notifications).

-- Sports a person muted for "new activity posted" notifications (all on by default, so only the exceptions are stored).
create table notify_off (
  user_id text not null references "user" (id) on delete cascade,
  sport text not null check (sport in ('ride', 'run', 'swim', 'pickleball', 'ski', 'other')),
  primary key (user_id, sport)
);

-- A person's private calendar link. The link is signed with the Worker's secret over (user, version), so nothing secret
-- is stored; Reset bumps the version and the old link stops working.
create table calendar_links (
  user_id text primary key references "user" (id) on delete cascade,
  version integer not null,
  created_at text not null
);
