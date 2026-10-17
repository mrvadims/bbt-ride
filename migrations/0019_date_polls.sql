-- Date polls (DESIGN.md → Date polls): an Editor asks which day (or block of days) works; each person asked answers
-- In / Maybe / Out per option, with an optional note, and the poll has its own message thread.
create table date_polls (
  id text primary key,
  title text not null,
  note text not null default '',
  sport text, -- optional; sets the icon and who's notified (people who muted it aren't)
  private integer not null default 0, -- 1: only date_poll_guests see it
  closes_on text not null, -- the last day answers are taken (New York)
  closed_at text, -- closed early, or planned
  activity_id text references activities (id) on delete set null, -- the activity planned from it
  created_by text references "user" (id) on delete set null,
  created_at text not null,
  updated_at text not null
);
create index date_polls_created on date_polls (created_at);

create table date_poll_guests (
  poll_id text not null references date_polls (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  primary key (poll_id, user_id)
);
create index date_poll_guests_user on date_poll_guests (user_id);

create table date_poll_options (
  id text primary key,
  poll_id text not null references date_polls (id) on delete cascade,
  starts_on text not null,
  ends_on text not null -- = starts_on for a single day; blocks are 2–4 days
);
create index date_poll_options_poll on date_poll_options (poll_id, starts_on);

create table date_poll_answers (
  option_id text not null references date_poll_options (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  status text not null, -- 'in', 'maybe', 'out' (checked by the app)
  note text,
  updated_at text not null,
  primary key (option_id, user_id)
);
create index date_poll_answers_user on date_poll_answers (user_id);

create table date_poll_notes ( -- each person's note on the whole poll
  poll_id text not null references date_polls (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  note text not null,
  updated_at text not null,
  primary key (poll_id, user_id)
);

-- A poll's message thread, made with it, like an activity's (0018).
alter table threads add column poll_id text references date_polls (id) on delete cascade;
create unique index threads_poll on threads (poll_id) where poll_id is not null;
create trigger poll_thread after insert on date_polls
begin
  insert or ignore into threads (id, kind, poll_id, created_at) values (new.id, 'poll', new.id, new.created_at);
end;

-- When each person last read a thread (activities keep their own visits in activity_seen).
create table thread_seen (
  thread_id text not null references threads (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  seen_at text not null,
  primary key (thread_id, user_id)
);

-- The copy kept by 0018 while the threads change settled.
drop table messages_v1;
