// 테스트용 가상 데이터: the law text and the source list below are made up for tests.
// The PDF checks use the committed fake 등기부 (tests/fixtures/fake-01-apartment.pdf).
import { describe, expect, it } from "vitest";
import {
  garbledRatio,
  htmlToText,
  parseSourcesTable,
  pdfPages,
  splitByArticle,
  splitByHeading,
  toChunks,
} from "../scripts/chunking.mjs";

const LAW = `가상임대차법
제1조(목적) 이 법은 테스트를 위한 가상 법률이다.
제2조(정의) 이 법에서 "보증금"이란 다음과 같다.
① 첫째 항
② 둘째 항
제2조의2(보증금의 회수) 임차인은 보증금을 돌려받을 수 있다.
부칙 <제1호, 2026. 1. 1.>
이 법은 공포한 날부터 시행한다.`;

describe("splitByArticle (법령: 조문 단위)", () => {
  it("cuts at every 제N조 / 제N조의M heading and keeps the heading as the locator", () => {
    const parts = splitByArticle(LAW);
    expect(parts.map((p) => p.locator)).toEqual(["제1조(목적)", "제2조(정의)", "제2조의2(보증금의 회수)"]);
    expect(parts[1].text).toContain("② 둘째 항");
  });

  it("drops the 부칙 and the text before the first article", () => {
    const parts = splitByArticle(LAW);
    expect(parts.some((p) => p.text.includes("공포한 날"))).toBe(false);
    expect(parts.some((p) => p.text.includes("가상임대차법"))).toBe(false);
  });

  it("does not cut at a 조 mentioned inside a sentence", () => {
    const parts = splitByArticle("제1조(목적) 제3조에 따른 금액을 말한다.\n제2조(기타) 끝.");
    expect(parts).toHaveLength(2);
    expect(parts[0].text).toContain("제3조에 따른");
  });
});

describe("splitByHeading (쪽 없는 안내 문서: 소제목 단위)", () => {
  it("cuts at h2/h3 headings", () => {
    const html = "<h1>안내</h1><p>머리말</p><h2>계약 전</h2><p>등기부를 보세요.</p><h3>잔금 전</h3><p>다시 보세요.</p>";
    const parts = splitByHeading(html);
    expect(parts).toEqual([
      { locator: "계약 전", text: "계약 전\n등기부를 보세요." },
      { locator: "잔금 전", text: "잔금 전\n다시 보세요." },
    ]);
  });
});

describe("htmlToText", () => {
  it("removes scripts, styles and tags and keeps line breaks between blocks", () => {
    expect(htmlToText("<script>x()</script><style>p{}</style><p>가 &amp; 나</p><div>다</div>")).toBe("가 & 나\n다");
  });
});

describe("garbledRatio (깨진 한글 찾기)", () => {
  it("is near 0 for normal Korean and high for broken text", () => {
    expect(garbledRatio("주택임대차보호법 제3조의2")).toBe(0);
    expect(garbledRatio("�� abc")).toBeGreaterThan(0.5);
  });
});

describe("pdfPages (PDF: 쪽 단위)", () => {
  it("reads every page of a Korean PDF without broken characters", async () => {
    const pages = await pdfPages("tests/fixtures/fake-01-apartment.pdf");
    expect(pages).toHaveLength(3);
    expect(pages[0].replace(/\s/g, "")).toContain("서울특별시송파구가락동9101");
    expect(pages[1].replace(/\s/g, "")).toContain("근저당권설정");
    for (const p of pages) expect(garbledRatio(p)).toBeLessThan(0.01);
  });
});

describe("parseSourcesTable (SOURCES.md)", () => {
  const md = `# 공식 문서 목록

| id | 파일 | 문서명 | 기관 | 주소 | 확인한 날짜 | 나누는 단위 |
|---|---|---|---|---|---|---|
| law-test | law-test.txt | 가상임대차법 | 가상처 | https://example.go.kr/law | 2026-10-15 | 조문 |
| guide-test | guide.pdf | 가상 안내서 | 가상공사 | https://example.or.kr/guide | 2026-10-14 | 쪽 |
`;

  it("reads one entry per row", () => {
    expect(parseSourcesTable(md)).toEqual([
      { id: "law-test", file: "law-test.txt", title: "가상임대차법", org: "가상처", url: "https://example.go.kr/law", checkedDate: "2026-10-15", unit: "조문" },
      { id: "guide-test", file: "guide.pdf", title: "가상 안내서", org: "가상공사", url: "https://example.or.kr/guide", checkedDate: "2026-10-14", unit: "쪽" },
    ]);
  });

  it("rejects an unknown 나누는 단위 or a bad date", () => {
    expect(() => parseSourcesTable(md.replace("| 조문 |", "| 문단 |"))).toThrow("나누는 단위");
    expect(() => parseSourcesTable(md.replace("2026-10-15", "10월 15일"))).toThrow("확인한 날짜");
  });
});

describe("toChunks", () => {
  it("labels every piece with 문서명·위치·주소 and a stable id", () => {
    const source = { id: "law-test", file: "x", title: "가상임대차법", org: "가상처", url: "https://example.go.kr/law", checkedDate: "2026-10-15", unit: "조문" as const };
    const chunks = toChunks(source, splitByArticle(LAW));
    expect(chunks[2]).toEqual({
      id: "law-test#제2조의2",
      sourceId: "law-test",
      title: "가상임대차법",
      org: "가상처",
      url: "https://example.go.kr/law",
      checkedDate: "2026-10-15",
      locator: "제2조의2(보증금의 회수)",
      text: "제2조의2(보증금의 회수) 임차인은 보증금을 돌려받을 수 있다.",
    });
  });

  it("uses the page number for PDF pages and skips empty pages", () => {
    const source = { id: "guide", file: "g.pdf", title: "안내서", org: "기관", url: "https://example.or.kr", checkedDate: "2026-10-15", unit: "쪽" as const };
    const chunks = toChunks(source, [{ locator: "1쪽", text: "첫 쪽" }, { locator: "2쪽", text: "  " }, { locator: "3쪽", text: "셋째 쪽" }]);
    expect(chunks.map((c) => c.id)).toEqual(["guide#1쪽", "guide#3쪽"]);
  });
});
