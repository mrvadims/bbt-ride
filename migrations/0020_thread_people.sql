-- Message notifications (DESIGN.md → Message notifications): per person and thread, a choice to follow or mute it, and
-- when they were last alerted about it, so later messages update that notification quietly until they open the thread.
create table thread_people (
  thread_id text not null references threads (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  notify integer, -- 1: follow, 0: muted, null: the default (In or Maybe, its creator, or posted in it)
  alerted_at text,
  primary key (thread_id, user_id)
);

-- Each new message looks up whether its possible recipients have a device.
create index push_subscriptions_user on push_subscriptions (user_id);
