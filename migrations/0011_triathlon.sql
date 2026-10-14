-- Triathlon (DESIGN.md → Sports, 2026-10-14). The sport lists stop being fixed in the database: the API validates
-- sports (shared/sports.ts), so a future sport needs no migration.
--
-- activities: swap the sport column for one without the CHECK. The table itself is never dropped, so RSVPs, messages
-- and routes (which reference it with ON DELETE CASCADE) are untouched.
alter table activities add column sport_v2 text not null default 'ride';
update activities set sport_v2 = sport;
drop index activities_one_published_per_sport_date;
alter table activities drop column sport;
alter table activities rename column sport_v2 to sport;
create unique index activities_one_published_per_sport_date on activities (date, sport) where status = 'published';

-- notify_off: nothing references it, so it is rebuilt.
create table notify_off_v2 (
  user_id text not null references "user" (id) on delete cascade,
  sport text not null,
  primary key (user_id, sport)
);
insert into notify_off_v2 (user_id, sport) select user_id, sport from notify_off;
drop table notify_off;
alter table notify_off_v2 rename to notify_off;

-- Offered straight away: added to the team's sports if an Admin has saved that setting (the default list has it).
update settings set value_json = json_insert(value_json, '$[#]', 'triathlon')
where key = 'sports' and not exists (select 1 from json_each(settings.value_json) where value = 'triathlon');
