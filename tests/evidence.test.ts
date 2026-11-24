import { describe, expect, it } from "vitest";
import { citedBookSources, hasUnknownBookCitations, isReadable, selectEvidence } from "@api/server/evidence";
import { safeUrl } from "@/lib/contract";

const readable = "A headache can have several causes. This passage contains readable medical text and preserves symbols such as α, β, µ and ≥ for educational study. ";
describe("book evidence", () => {
  it("rejects the private-use glyph corruption seen in the indexed PDF without rejecting medical Unicode", () => {
    expect(isReadable("\uF0B7\uF0AE\uF0B1\uF0B3 ".repeat(80))).toBe(false);
    expect(isReadable(readable)).toBe(true);
    expect(isReadable(" ")).toBe(false);
  });
  it("deduplicates and bounds context, retaining real source identities", () => {
    const chunks = Array.from({ length: 10 }, (_, index) => ({ chunk_id: `${index}`, title: `Book ${index}`, chunk: `${index} ${readable.repeat(100)}` }));
    const selected = selectEvidence([chunks[0], chunks[0], ...chunks.slice(1)]);
    expect(selected.length).toBeLessThanOrEqual(5);
    expect(selected.reduce((sum, item) => sum + item.text.length, 0)).toBeLessThanOrEqual(16000);
    expect(selected[0].title).toBe("Book 0");
    expect(new Set(selected.map((item) => item.text)).size).toBe(selected.length);
  });
  it("lists only cited real books and flags invented identifiers", () => {
    const evidence = [{ id: "B1", title: "A real book", text: readable }];
    expect(citedBookSources("Supported [B1]. Invented [B99].", evidence)).toEqual([{ kind: "books", id: "B1", title: "A real book" }]);
    expect(hasUnknownBookCitations("[B99]", evidence)).toBe(true);
  });
  it("rejects executable citation URL schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("https://www.nhs.uk/conditions/headaches/")).toBe("https://www.nhs.uk/conditions/headaches/");
  });
});
