import { describe, expect, it } from "vitest";
import { pollAnswers, pollInput } from "../shared/api.ts";
import { daysIn, defaultCloses, lastDay, nextWeekend, optionLabel, optionsProblem, ranked } from "../shared/polls.ts";

const today = "2026-10-17"; // a Saturday

describe("date poll options", () => {
  it("labels a day and a block, across a month end", () => {
    expect(optionLabel({ startsOn: "2026-10-24", endsOn: "2026-10-24" })).toBe("Sat, Oct 24");
    expect(optionLabel({ startsOn: "2026-10-24", endsOn: "2026-10-25" })).toBe("Sat–Sun, Oct 24–25");
    expect(optionLabel({ startsOn: "2026-10-30", endsOn: "2026-11-01" })).toBe("Fri–Sun, Oct 30–Nov 1");
  });
  it("counts days", () => {
    expect(daysIn({ startsOn: "2026-10-31", endsOn: "2026-11-03" })).toBe(4);
    expect(daysIn({ startsOn: "2026-10-31", endsOn: "2026-10-31" })).toBe(1);
  });
  it("allows up to 14 options, from today to a year ahead, blocks of at most 4 days", () => {
    expect(optionsProblem([{ startsOn: today, endsOn: today }], today)).toBeNull();
    expect(optionsProblem([], today)).toMatch(/at least one/);
    expect(optionsProblem([{ startsOn: "2026-10-16", endsOn: "2026-10-16" }], today)).toMatch(/today or later/);
    expect(optionsProblem([{ startsOn: "2027-10-17", endsOn: "2027-10-17" }], today)).toBeNull();
    expect(optionsProblem([{ startsOn: "2027-10-18", endsOn: "2027-10-18" }], today)).toMatch(/12 months/);
    expect(optionsProblem([{ startsOn: "2026-10-24", endsOn: "2026-10-28" }], today)).toMatch(/at most 4 days/);
    expect(optionsProblem([{ startsOn: "2026-10-25", endsOn: "2026-10-24" }], today)).toMatch(/ends before/);
    const twice = { startsOn: "2026-10-24", endsOn: "2026-10-25" };
    expect(optionsProblem([twice, twice], today)).toMatch(/twice/);
    const many = Array.from({ length: 15 }, (_, i) => ({
      startsOn: `2026-11-${String(i + 1).padStart(2, "0")}`,
      endsOn: `2026-11-${String(i + 1).padStart(2, "0")}`,
    }));
    expect(optionsProblem(many, today)).toMatch(/at most 14/);
    expect(optionsProblem(many.slice(0, 14), today)).toBeNull();
  });
  it("closes answers the day before the first option, never before today", () => {
    const opts = [
      { startsOn: "2026-11-07", endsOn: "2026-11-08" },
      { startsOn: "2026-10-24", endsOn: "2026-10-25" },
    ];
    expect(defaultCloses(opts, today)).toBe("2026-10-23");
    expect(defaultCloses([{ startsOn: today, endsOn: today }], today)).toBe(today);
    expect(lastDay(opts)).toBe("2026-11-08");
  });
  it("ranks by In, then Maybe, then the earliest", () => {
    const r = ranked([
      { startsOn: "2026-10-24", endsOn: "2026-10-25", inCount: 5, maybeCount: 4 },
      { startsOn: "2026-10-31", endsOn: "2026-11-01", inCount: 8, maybeCount: 3 },
      { startsOn: "2026-11-07", endsOn: "2026-11-08", inCount: 5, maybeCount: 4 },
      { startsOn: "2026-11-14", endsOn: "2026-11-15", inCount: 5, maybeCount: 6 },
    ]);
    expect(r.map((o) => o.startsOn)).toEqual(["2026-10-31", "2026-11-14", "2026-10-24", "2026-11-07"]);
  });
  it("offers the next weekend that isn't taken", () => {
    expect(nextWeekend(today, [])).toEqual({ startsOn: "2026-10-17", endsOn: "2026-10-18" });
    expect(nextWeekend(today, [{ startsOn: "2026-10-17", endsOn: "2026-10-18" }])).toEqual({
      startsOn: "2026-10-24",
      endsOn: "2026-10-25",
    });
    expect(nextWeekend("2026-10-18", [])).toEqual({ startsOn: "2026-10-24", endsOn: "2026-10-25" }); // Sunday
  });
});

describe("date poll requests", () => {
  it("needs a title and at least one date; guests default to everyone", () => {
    expect(pollInput.safeParse({ title: " ", options: [{ startsOn: today, endsOn: today }] }).success).toBe(false);
    expect(pollInput.safeParse({ title: "Gunks", options: [] }).success).toBe(false);
    const ok = pollInput.parse({ title: "Gunks", options: [{ startsOn: today, endsOn: today }] });
    expect(ok.guests).toBeNull();
    expect(ok.closesOn).toBeNull();
  });
  it("answers are in, maybe, out or cleared, with short notes", () => {
    expect(pollAnswers.safeParse({ answers: [{ optionId: "o", status: "maybe" }] }).success).toBe(true);
    expect(pollAnswers.safeParse({ answers: [{ optionId: "o", status: "yes" }] }).success).toBe(false);
    expect(pollAnswers.safeParse({ answers: [{ optionId: "o", status: null, note: "x".repeat(141) }] }).success).toBe(
      false,
    );
  });
});
