// 테스트용 가상 데이터: the chunks below are made up; real-document tests come after docs/sources/ is filled.
import { describe, expect, it } from "vitest";
import { buildIndex, search, tokenize, type Chunk } from "../src/agent/retrieve";

const chunk = (id: string, text: string): Chunk => ({
  id,
  sourceId: id.split("#")[0],
  title: "가상 안내서",
  org: "가상기관",
  url: "https://example.go.kr",
  checkedDate: "2026-10-15",
  locator: id.split("#")[1] ?? "1쪽",
  text,
});

const CHUNKS = [
  chunk("guide#1쪽", "전세 계약 전에는 등기부등본을 떼어 소유자를 확인하세요."),
  chunk("guide#2쪽", "근저당이 많으면 집이 경매로 넘어갈 때 보증금을 돌려받지 못할 수 있습니다. 근저당 금액을 확인하세요."),
  chunk("guide#3쪽", "신탁 등기가 된 집은 수탁자(신탁회사)의 동의 없이 맺은 임대차계약이 보호받지 못할 수 있습니다. 신탁원부를 확인하세요."),
  chunk("guide#4쪽", "전입신고와 확정일자를 받으면 대항력과 우선변제권이 생깁니다."),
  chunk("guide#5쪽", "계약은 공인중개사를 통해 하고, 확인·설명서를 받으세요. 계약 전 확인할 것이 많습니다. 확인 확인 확인."),
];
const index = buildIndex(CHUNKS);
const ids = (query: string, k = 3) => search(index, query, k).map((r) => r.chunk.id);

describe("tokenize (글자 2개 묶기)", () => {
  it("makes bigrams inside each word, so 조사 do not block a match", () => {
    expect(tokenize("근저당이 있다")).toEqual(["근저", "저당", "당이", "있다"]);
  });

  it("splits on punctuation and keeps digits", () => {
    expect(tokenize("제3조의2(보증금)")).toEqual(["제3", "3조", "조의", "의2", "보증", "증금"]);
  });

  it("keeps a one-letter word as itself and lowercases Latin letters", () => {
    expect(tokenize("집 HUG")).toEqual(["집", "hu", "ug"]);
  });

  it("ignores empty text", () => {
    expect(tokenize("  ·, ")).toEqual([]);
  });
});

describe("search (BM25)", () => {
  it("finds the chunk about the query first, even with a different 조사", () => {
    expect(ids("근저당을")[0]).toBe("guide#2쪽");
    expect(ids("신탁 수탁자 동의")[0]).toBe("guide#3쪽");
    expect(ids("전입신고 확정일자")[0]).toBe("guide#4쪽");
  });

  it("weighs a rare word more than a common one", () => {
    // "확인" is in almost every chunk, "소유자" only in one
    expect(ids("소유자 확인")[0]).toBe("guide#1쪽");
  });

  it("does not let one repeated word win on its own (term saturation)", () => {
    expect(ids("신탁원부 확인")[0]).toBe("guide#3쪽");
  });

  it("returns at most k results, best first, with positive scores only", () => {
    const r = search(index, "보증금 근저당 확인", 2);
    expect(r).toHaveLength(2);
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score);
    expect(r.every((x) => x.score > 0)).toBe(true);
  });

  it("returns nothing when no word matches, instead of guessing", () => {
    expect(search(index, "주차장 관리비", 3)).toEqual([]);
    expect(search(index, "", 3)).toEqual([]);
  });

  it("is deterministic: equal scores keep the original chunk order", () => {
    const twins = buildIndex([chunk("a#1쪽", "보증보험 가입"), chunk("b#1쪽", "보증보험 가입")]);
    expect(search(twins, "보증보험", 2).map((r) => r.chunk.id)).toEqual(["a#1쪽", "b#1쪽"]);
  });
});
