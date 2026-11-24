import type { Source } from "../../../src/lib/contract";

export type Chunk = { chunk_id: string; parent_id?: string; title: string; chunk: string };
export type Evidence = { id: string; title: string; text: string };

export function isReadable(text: string): boolean {
  const visible = [...text].filter((character) => !/\s/u.test(character));
  if (visible.length < 60) return false;
  const damaged = visible.filter((character) => /[\p{Co}\uFFFD]/u.test(character)).length;
  return damaged / visible.length < 0.05 && /\p{L}{3}/u.test(text);
}

export function selectEvidence(chunks: Chunk[]): Evidence[] {
  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  let remaining = 16000;
  for (const chunk of chunks) {
    if (evidence.length === 5 || remaining < 200) break;
    const text = chunk.chunk.trim();
    if (!chunk.title.trim() || !isReadable(text) || seen.has(text)) continue;
    seen.add(text);
    const excerpt = text.slice(0, Math.min(4000, remaining));
    evidence.push({ id: `B${evidence.length + 1}`, title: chunk.title, text: excerpt });
    remaining -= excerpt.length;
  }
  return evidence;
}

export function citedBookSources(text: string, evidence: Evidence[]): Source[] {
  const ids = new Set([...text.matchAll(/\[(B\d+)\]/g)].map((match) => match[1]));
  return evidence.filter((source) => ids.has(source.id))
    .map(({ id, title }) => ({ kind: "books", id, title }));
}

export function hasUnknownBookCitations(text: string, evidence: Evidence[]): boolean {
  const known = new Set(evidence.map((source) => source.id));
  return [...text.matchAll(/\[(B\d+)\]/g)].some((match) => !known.has(match[1]));
}
