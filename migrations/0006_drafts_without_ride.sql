-- drafts.ride_id was never read (the form itself says which ride it edits). SQLite can't drop a column with a foreign
-- key, so the table is recreated; drafts are short-lived autosaves.
drop table drafts;
create table drafts (
  user_id text primary key references "user" (id) on delete cascade,
  form_json text not null,
  updated_at text not null
);
