-- Announcements (DESIGN.md → v2, Announcements): an Admin's message to everyone, shown as a banner until each person
-- taps Got it. Active while not ended and its end date (New York, inclusive) hasn't passed.
create table announcements (
  id text primary key,
  title text not null,
  body text not null,
  ends_on text,      -- YYYY-MM-DD, last day shown; null: until everyone has seen it (or an Admin ends it)
  ended_at text,     -- an Admin's End now
  created_by text references "user" (id) on delete set null,
  created_at text not null,
  updated_at text not null
);
create table announcement_seen (
  announcement_id text not null references announcements (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  at text not null,
  primary key (announcement_id, user_id)
);
