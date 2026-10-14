// Web links in notes and thread messages become tappable (http, https or www.; nothing else, so no javascript: links).
type Piece = { text: string } | { text: string; href: string };

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

/** Splits text into plain pieces and links. Trailing punctuation (a full stop, a closing bracket nobody opened)
 * stays outside the link. */
export function splitLinks(text: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    while (/[.,;:!?'*]$/.test(url) || (url.endsWith(")") && !url.includes("("))) url = url.slice(0, -1);
    const start = m.index ?? 0;
    if (start > at) out.push({ text: text.slice(at, start) });
    out.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url });
    at = start + url.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
