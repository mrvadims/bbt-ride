// Text with its web links tappable (src/lib/links.ts); line breaks are kept by the surrounding element's CSS.
import { splitLinks } from "../lib/links.ts";

export function Linkified({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((p, i) =>
        "href" in p ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer">
            {p.text}
          </a>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
