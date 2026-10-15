-- Private activities (DESIGN.md → v2, Private activities): seen only by the people invited, its creator among them.
-- A public activity has no rows here.
alter table activities add column private integer not null default 0;
create table activity_guests (
  activity_id text not null references activities (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  primary key (activity_id, user_id)
);
create index activity_guests_user on activity_guests (user_id);
