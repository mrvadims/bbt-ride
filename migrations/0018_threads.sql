-- Message threads (DESIGN.md → Messages, ARCHITECTURE.md → Data model): a message belongs to a thread, and a thread to
-- its owner. Today every activity has one; date polls come next, then maybe announcements or a team thread. Each owner
-- kind gets its own nullable column on threads (added later with ALTER TABLE … ADD COLUMN, which needs no rebuild), so
-- deleting the owner cascades to its thread and the thread's messages.
--
-- The old table is renamed, not dropped, so a bad deploy can still be undone; a later migration drops messages_v1.
-- `kind` on both tables is checked by the app, not a CHECK, so adding a kind never needs a table rebuild. An owner's
-- thread is made by a trigger when the owner is inserted.
alter table messages rename to messages_v1;

create table threads (
  id text primary key, -- an activity's thread has the activity's id
  kind text not null, -- 'activity'
  activity_id text unique references activities (id) on delete cascade,
  created_at text not null
);

create table messages (
  id text primary key,
  thread_id text not null references threads (id) on delete cascade,
  user_id text references "user" (id) on delete set null,
  parent_id text references messages (id) on delete cascade,
  kind text not null default 'user', -- 'user', or a system note: 'update', 'cancel', 'restore'
  body text not null,
  created_at text not null,
  edited_at text,
  deleted_at text
);
create index messages_thread on messages (thread_id, created_at);

insert into threads (id, kind, activity_id, created_at) select id, 'activity', id, created_at from activities;

-- Every activity gets its thread as it's created, whatever code inserts it (including the old code still running in the
-- minute between this migration and the new deploy).
create trigger activity_thread after insert on activities
begin
  insert or ignore into threads (id, kind, activity_id, created_at) values (new.id, 'activity', new.id, new.created_at);
end;

-- Top-level messages first, so every reply's parent is already there.
insert into messages (id, thread_id, user_id, parent_id, kind, body, created_at, edited_at, deleted_at)
select id, activity_id, user_id, parent_id, kind, body, created_at, edited_at, deleted_at
from messages_v1 where parent_id is null;
insert into messages (id, thread_id, user_id, parent_id, kind, body, created_at, edited_at, deleted_at)
select id, activity_id, user_id, parent_id, kind, body, created_at, edited_at, deleted_at
from messages_v1 where parent_id is not null;
