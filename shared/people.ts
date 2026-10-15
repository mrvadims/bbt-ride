// Names, phone numbers and @mentions (DESIGN.md → Team and contacts, Mentions), shared by the Worker and the app.

/** How the app shows someone whose account was deleted. */
export const FORMER_MEMBER = "Former member";
export const firstName = (name: string | null | undefined) => (name ?? FORMER_MEMBER).split(" ")[0] ?? "";

/** A name as stored: invisible and direction-changing characters removed, spaces collapsed. The joiners that hold
 * compound emoji together (👨‍👩‍👧, 🏳️‍🌈) and the tag characters of regional flags (🏴󠁧󠁢󠁳󠁣󠁴󠁿) stay. */
export const cleanName = (name: string) =>
  name
    .replace(/(?![\u200C\u200D\u{E0020}-\u{E007F}])[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .replace(/\s+/g, " ");

/** A phone number as stored: "+" and 8–15 digits. US numbers may be typed without the country code. Null if it isn't one. */
export function normalizePhone(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (/[^\d\s().+-]/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (s.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** "+19145550142" → "(914) 555-0142"; other countries stay as stored. */
export function fmtPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

// A mention is stored in the message body as <@userId>, so it follows the person when they rename. The app shows
// "@Name"; notifications and anything else that shows plain text get the name in place of the token.
const TOKEN = /<@([A-Za-z0-9_-]{1,64})>/g;
/** At most this many people per message (each is notified). */
export const MAX_MENTIONS = 10;

/** The people mentioned in a body, each once, in order. */
export function mentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(TOKEN)].map((m) => m[1] as string))];
}

type BodyPart = { text: string } | { mention: string };
/** A body split into text and mentions (user ids). */
export function splitMentions(body: string): BodyPart[] {
  const out: BodyPart[] = [];
  let at = 0;
  for (const m of body.matchAll(TOKEN)) {
    if (m.index > at) out.push({ text: body.slice(at, m.index) });
    out.push({ mention: m[1] as string });
    at = m.index + m[0].length;
  }
  if (at < body.length) out.push({ text: body.slice(at) });
  return out;
}

/** The body as plain text, each mention as "@Name". */
export function plainMentions(body: string, nameOf: (id: string) => string | undefined): string {
  return body.replace(TOKEN, (_, id: string) => `@${nameOf(id) ?? FORMER_MEMBER}`);
}

/** The composer works in "@Name" text; this turns the names picked from the team list into tokens when sending. A name
 * must end there ("@Jo" isn't "@Joanna"), and longer names go first, so "@Jo Park" wins over "@Jo". */
export function encodeMentions(text: string, picked: { id: string; name: string }[]): string {
  let out = text;
  for (const p of [...picked].sort((a, b) => b.name.length - a.name.length)) {
    const name = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`@${name}(?![\\p{L}\\p{N}])`, "gu"), `<@${p.id}>`);
  }
  return out;
}
