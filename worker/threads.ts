// Message threads (DESIGN.md → Messages, migrations/0018_threads.sql): every message belongs to a thread, and every thread
// to one owner. Owners today: activities and date polls. A new owner kind adds a nullable column on threads, a trigger that makes the
// thread when the owner is inserted, and an entry in OWNER below; who may read and post stays with the owner's route,
// which checks it before calling these. Editing and deleting a message, in any thread, go through routes/messages.ts.
import type { Message } from "../shared/api.ts";
import { newId, nowIso } from "./util.ts";

export type OwnerKind = "activity" | "poll";
export interface Owner {
  kind: OwnerKind;
  id: string;
}
/** The threads column that points at each kind of owner (constants only: these go into SQL). */
const OWNER = { activity: "activity_id", poll: "poll_id" } as const satisfies Record<OwnerKind, string>;

/** SQL joining a message `m` to its thread `t`, for queries that filter by owner (`t.activity_id = …`). */
export const MESSAGES_OF = "messages m join threads t on t.id = m.thread_id";

/** A new message in the owner's thread: a person's (with `userId`) or a system note (update, cancel, restore). */
export const postMessage = (
  db: D1Database,
  owner: Owner,
  m: { userId?: string | null; parentId?: string | null; kind?: Message["kind"]; body: string },
) =>
  db
    .prepare(
      `insert into messages (id, thread_id, user_id, parent_id, kind, body, created_at)
       select ?, t.id, ?, ?, ?, ?, ? from threads t where t.${OWNER[owner.kind]} = ?`,
    )
    .bind(newId(), m.userId ?? null, m.parentId ?? null, m.kind ?? "user", m.body, nowIso(), owner.id);

/** Replies go one level deep: the parent must be a top-level message in the same thread. */
export async function checkParent(db: D1Database, owner: Owner, parentId: string) {
  const parent = await db
    .prepare(`select m.parent_id from ${MESSAGES_OF} where m.id = ? and t.${OWNER[owner.kind]} = ?`)
    .bind(parentId, owner.id)
    .first<{ parent_id: string | null }>();
  return Boolean(parent && !parent.parent_id);
}

export interface MessageRow {
  id: string;
  parent_id: string | null;
  kind: Message["kind"];
  user_id: string | null;
  name: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

/** Every message in the owner's thread, oldest first, with the author's current name. */
export const threadMessages = (db: D1Database, owner: Owner) =>
  db
    .prepare(
      `select m.id, m.parent_id, m.kind, m.user_id, u.name, m.body, m.created_at, m.edited_at, m.deleted_at
       from ${MESSAGES_OF} left join "user" u on u.id = m.user_id where t.${OWNER[owner.kind]} = ? order by m.created_at`,
    )
    .bind(owner.id);

/** A message as the API returns it; a deleted one keeps its place with no text. */
export const messageOf = (m: MessageRow): Message => ({
  id: m.id,
  parentId: m.parent_id,
  kind: m.kind,
  authorId: m.user_id,
  authorName: m.name,
  body: m.deleted_at ? "" : m.body,
  createdAt: m.created_at,
  editedAt: m.edited_at,
  deleted: Boolean(m.deleted_at),
});

/** Statements that delete the owner's thread and messages, replies first (for a batch that deletes the owner). */
export const deleteThread = (db: D1Database, owner: Owner) => {
  const col = OWNER[owner.kind];
  return [
    db
      .prepare(
        `delete from messages where parent_id is not null and thread_id in (select id from threads where ${col} = ?)`,
      )
      .bind(owner.id),
    db.prepare(`delete from messages where thread_id in (select id from threads where ${col} = ?)`).bind(owner.id),
    db.prepare(`delete from threads where ${col} = ?`).bind(owner.id),
  ];
};

/** When the viewer last read the owner's thread (null: never), and now records this visit. */
export async function readThread(db: D1Database, owner: Owner, viewer: string): Promise<string | null> {
  const col = OWNER[owner.kind];
  const [prev] = await db.batch([
    db
      .prepare(
        `select s.seen_at from thread_seen s join threads t on t.id = s.thread_id where t.${col} = ? and s.user_id = ?`,
      )
      .bind(owner.id, viewer),
    db
      .prepare(
        `insert into thread_seen (thread_id, user_id, seen_at) select t.id, ?, ? from threads t where t.${col} = ?
         on conflict (thread_id, user_id) do update set seen_at = excluded.seen_at`,
      )
      .bind(viewer, nowIso(), owner.id),
  ]);
  return (prev?.results?.[0] as { seen_at: string } | undefined)?.seen_at ?? null;
}
