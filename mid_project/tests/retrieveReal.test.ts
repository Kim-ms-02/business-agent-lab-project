// Search tests on the real official-document chunks (docs/sources/chunks.json, v0.5 step 6).
// Every query, expected chunk, default question and glossary entry here was approved in step 5.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEARCH_TOP_K } from "../src/agent/config";
import { DEFAULT_QUESTIONS, EXPECTED_CHUNKS, GLOSSARY, TOPIC_QUERIES } from "../src/agent/content";
import { extractNumbers, type TopicId } from "../src/agent/explain";
import { buildIndex, search, type Chunk } from "../src/agent/retrieve";

const { chunks } = JSON.parse(readFileSync(join(__dirname, "../docs/sources/chunks.json"), "utf8")) as { chunks: Chunk[] };
const index = buildIndex(chunks);
const topics = Object.keys(TOPIC_QUERIES) as TopicId[];
const found = (topic: TopicId) => search(index, TOPIC_QUERIES[topic], SEARCH_TOP_K).map((h) => h.chunk.id);

describe("실제 공식 문서 검색", () => {
  it("has a query for every topic, at least 6 in all", () => {
    expect(topics.sort()).toEqual(
      ["address", "basics", "guarantee", "jeonseRatio", "landlord", "recentTransfer", "seniorBurden", "tenancy:임차권", "tenancy:전세권", "titleIssues"].sort(),
    );
  });

  it("names only chunks that exist", () => {
    const ids = new Set(chunks.map((c) => c.id));
    const named = [
      ...Object.values(EXPECTED_CHUNKS).flat(),
      ...Object.values(DEFAULT_QUESTIONS).flat().map((q) => q.source),
      ...GLOSSARY.map((g) => g.source),
    ];
    expect(named.filter((id) => !ids.has(id))).toEqual([]);
  });

  it.each(topics)("%s: every expected chunk is in the top results", (topic) => {
    const ids = found(topic);
    expect(ids).toHaveLength(SEARCH_TOP_K);
    for (const id of EXPECTED_CHUNKS[topic]) expect(ids).toContain(id);
  });

  it.each(topics)("%s: every default question's chunk is found for that topic, so none is hidden", (topic) => {
    const ids = found(topic);
    for (const q of DEFAULT_QUESTIONS[topic] ?? []) expect(ids).toContain(q.source);
  });

  it("every glossary entry's chunk is found for at least one topic", () => {
    const all = new Set(topics.flatMap(found));
    expect(GLOSSARY.filter((g) => !all.has(g.source)).map((g) => g.term)).toEqual([]);
  });

  it("the safe case shows 대항력, 우선변제권 and 확정일자", () => {
    const basics = new Set(found("basics"));
    const shown = GLOSSARY.filter((g) => basics.has(g.source)).map((g) => g.term);
    expect(shown).toEqual(expect.arrayContaining(["대항력", "우선변제권", "확정일자"]));
  });

  it("default questions and glossary wording carry no numbers (nothing for the number check to miss)", () => {
    const texts = [...Object.values(DEFAULT_QUESTIONS).flat().map((q) => q.text), ...GLOSSARY.map((g) => `${g.term} ${g.plain}`)];
    expect(texts.filter((t) => extractNumbers(t).length > 0)).toEqual([]);
  });

  it("every topic has at least one default question", () => {
    expect(topics.filter((t) => (DEFAULT_QUESTIONS[t] ?? []).length === 0)).toEqual([]);
  });
});
