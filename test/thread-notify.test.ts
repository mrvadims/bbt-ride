import { describe, expect, it } from "vitest";
import { threadSends } from "../worker/thread-notify.ts";

// DESIGN.md → Message notifications: one card per thread until it's opened; @here always alerts.
const m = { who: "Jo", text: "Still on?", name: "Armonk ride", url: "/a/x", tag: "thread-t" };
const at = (min: number) => `2026-10-17T15:${String(min).padStart(2, "0")}:00.000Z`;

describe("message notifications", () => {
  it("alerts people not alerted since they last opened the thread", () => {
    const { loud, sends } = threadSends(
      [
        { id: "new", alertedAt: null, seenAt: null },
        { id: "opened", alertedAt: at(1), seenAt: at(5) },
      ],
      false,
      [],
      m,
    );
    expect(loud).toEqual(["new", "opened"]);
    expect(sends).toEqual([
      {
        to: ["new", "opened"],
        message: { url: "/a/x", tag: "thread-t", title: "Jo · Armonk ride", body: "Still on?" },
      },
    ]);
  });
  it("updates the card quietly for people already alerted, counting messages from others since", () => {
    const recent = [
      { userId: "sam", createdAt: at(12) },
      { userId: "b", createdAt: at(14) }, // b's own message doesn't count for b
      { userId: "jo", createdAt: at(15) }, // this one
    ];
    const { loud, sends } = threadSends(
      [
        { id: "a", alertedAt: at(10), seenAt: at(2) },
        { id: "b", alertedAt: at(13), seenAt: null },
      ],
      false,
      recent,
      m,
    );
    expect(loud).toEqual([]);
    const quiet = sends.filter((s) => s.message.quiet);
    expect(quiet.map((s) => [s.to, s.message.title])).toEqual([
      [["a"], "4 new messages · Armonk ride"],
      [["b"], "2 new messages · Armonk ride"],
    ]);
    expect(quiet[0]?.message.body).toBe("Jo: Still on?");
  });
  it("always alerts on @here", () => {
    const { loud, sends } = threadSends([{ id: "a", alertedAt: at(10), seenAt: at(2) }], true, [], m);
    expect(loud).toEqual(["a"]);
    expect(sends[0]?.message.title).toBe("Jo to everyone · Armonk ride");
    expect(sends.some((s) => s.message.quiet)).toBe(false);
  });
});
