-- Several activities of a sport may share a day (DESIGN.md → v2, Plan); Plan's Replace is now the editor's choice.
drop index activities_one_published_per_sport_date;
create index activities_date_sport on activities (date, sport);

-- New, changed and unread markers on Home (DESIGN.md → New and unread). When each person last opened each activity;
-- before that, their baseline: the moment they first had markers, so what already existed then counts as seen.
create table activity_seen (
  user_id text not null references "user" (id) on delete cascade,
  activity_id text not null references activities (id) on delete cascade,
  seen_at text not null,
  primary key (user_id, activity_id)
);
create table seen_baseline (
  user_id text primary key references "user" (id) on delete cascade,
  at text not null
);
insert into seen_baseline (user_id, at) select id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from "user";
