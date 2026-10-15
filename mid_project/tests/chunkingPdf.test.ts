// 테스트용 가상 데이터: the page texts below are made up; they copy only the layout of the real PDFs
// (국가법령정보센터 page header, 안내서 running header with the printed page number, 별지 page).
import { describe, expect, it } from "vitest";
import {
  pageParts,
  parsePageList,
  parseSourcesTable,
  printedPageNumber,
  splitByArticle,
  splitLawPages,
  stripLawHeader,
  toChunks,
} from "../scripts/chunking.mjs";

const LAW_PAGES = [
  `법제처 1 국가법령정보센터
가상임대차법
가상임대차법 ( 약칭: 가상법 )
[시행 2026. 1. 2.] [법률 제1호, 2025. 10. 1., 타법개정]
제1조(목적) 이 법은 테스트를 위한 가상 법률이다.
제2조(대항력) ① 임차인은 전입신고를 마친 다음 날부터
효력이 생긴다.`,
  `법제처 2 국가법령정보센터
가상임대차법
② 둘째 항은 다음 쪽에 있다.
제3조 삭제 <1989. 12. 30.>
제4조(보증금) 보증금은 돌려받는다.
부칙 <제1호, 2025. 10. 1.>
제1조(시행일) 이 법은 공포한 날부터 시행한다.`,
];

describe("stripLawHeader (국가법령정보센터 PDF 머리글 지우기)", () => {
  it("drops the 법제처 page line and the law name under it", () => {
    expect(stripLawHeader(LAW_PAGES[1]).split("\n")[0]).toBe("② 둘째 항은 다음 쪽에 있다.");
  });

  it("keeps a page without that header as it is", () => {
    expect(stripLawHeader("제1조(목적) 그대로")).toBe("제1조(목적) 그대로");
  });
});

describe("splitByArticle: 삭제된 조문", () => {
  it("does not glue a deleted article onto the article before it", () => {
    const parts = splitByArticle("제4조(기간) 2년으로 본다.\n제5조 삭제 <1989. 12. 30.>\n제6조(갱신) 갱신한다.");
    expect(parts.map((p) => p.locator)).toEqual(["제4조(기간)", "제6조(갱신)"]);
    expect(parts[0].text).not.toContain("삭제");
  });
});

describe("splitLawPages (법령 PDF: 쪽을 이어 붙여 조문 단위)", () => {
  const parts = splitLawPages(LAW_PAGES);

  it("cuts per 조문 across pages, without page headers, deleted articles or 부칙", () => {
    expect(parts.map((p) => p.locator)).toEqual(["제1조(목적)", "제2조(대항력)", "제4조(보증금)"]);
    expect(parts[1].text).toBe("제2조(대항력) ① 임차인은 전입신고를 마친 다음 날부터\n효력이 생긴다.\n② 둘째 항은 다음 쪽에 있다.");
    expect(parts.some((p) => p.text.includes("법제처") || p.text.includes("공포한 날"))).toBe(false);
  });

  it("stores the PDF pages each 조문 came from", () => {
    expect(parts.map((p) => p.pdfPages)).toEqual([[1], [1, 2], [2]]);
  });
});

describe("printedPageNumber (인쇄된 쪽 번호 읽기)", () => {
  it.each([
    ["12 _ 전세사기피해 예방을 위한 전세계약 제대로 알고\n본문", 12],
    ["Ⅱ. 전세계약 제대로 알고 하기 _ 13\n본문", 13],
    ["100 _ 전세사기피해 예방을 위한 전세계약 제대로 알\n본문", 100],
    ["피해예방\n안내서", null],
    ["- 1 -\n보도자료", null],
    ["", null],
  ])("%j -> %j", (text, n) => {
    expect(printedPageNumber(text)).toBe(n);
  });
});

describe("parsePageList (뺄 쪽)", () => {
  it.each([
    ["4-6", [4, 5, 6]],
    ["9", [9]],
    ["3·13·98·115·116", [3, 13, 98, 115, 116]],
    ["3, 13, 115-116", [3, 13, 115, 116]],
    ["", []],
    ["-", []],
  ])("%j", (text, pages) => {
    expect(parsePageList(text)).toEqual(pages);
  });

  it("rejects text that is not a page list", () => {
    expect(() => parsePageList("4쪽부터")).toThrow();
    expect(() => parsePageList("6-4")).toThrow();
  });
});

describe("pageParts (PDF 쪽 단위)", () => {
  it("uses the PDF page number when the document prints none", () => {
    const { parts } = pageParts(["- 1 -\n첫 쪽", "- 2 -\n둘째 쪽"], []);
    expect(parts.map((p) => [p.locator, p.pdfPages])).toEqual([["1쪽", [1]], ["2쪽", [2]]]);
  });

  it("shows the printed page number from the running header, and marks pages without one", () => {
    const pages = ["체크리스트\n기본 사항", "", "1 _ 안내서 제목\n이 안내서를 읽는 법", "안내서 _ 2\n본문"];
    const { parts } = pageParts(pages, []);
    expect(parts.map((p) => [p.locator, p.pdfPages])).toEqual([
      ["PDF 1쪽(쪽 번호 없음)", [1]],
      ["PDF 2쪽(쪽 번호 없음)", [2]],
      ["1쪽", [3]],
      ["2쪽", [4]],
    ]);
  });

  it("skips the listed pages and reports them", () => {
    const { parts, skipped } = pageParts(["가", "나", "다", "라"], [2, 4]);
    expect(parts.map((p) => p.locator)).toEqual(["1쪽", "3쪽"]);
    expect(skipped).toEqual([2, 4]);
  });

  it("names a 별지 page by its title", () => {
    const { parts } = pageParts(["- 1 / 1 -\n본문", "별지2)\n- 2 / 1 -\n계약갱신 거절통지서\n임대인 성명"], []);
    expect(parts[1].locator).toBe("2쪽(별지: 계약갱신 거절통지서)");
  });
});

describe("parseSourcesTable: 뺄 쪽·비고", () => {
  const md = `| id | 파일 | 문서명 | 기관 | 주소 | 확인한 날짜 | 나누는 단위 | 뺄 쪽 | 비고 |
|---|---|---|---|---|---|---|---|---|
| press | press.pdf | 가상 보도자료 | 가상부 | https://example.go.kr | 2026-10-15 | 쪽 | 4-6 | |
| contract | c.pdf | 가상 계약서 | 가상부 | https://example.go.kr | 2026-10-15 | 쪽 | | 게시 파일 2023-10-06 |
`;

  it("reads the optional columns", () => {
    const [press, contract] = parseSourcesTable(md);
    expect(press.skipPages).toEqual([4, 5, 6]);
    expect(press.note).toBeUndefined();
    expect(contract.skipPages).toEqual([]);
    expect(contract.note).toBe("게시 파일 2023-10-06");
  });

  it("names the document when 뺄 쪽 cannot be read", () => {
    expect(() => parseSourcesTable(md.replace("| 4-6 |", "| 넷째 쪽 |"))).toThrow("press");
  });
});

describe("toChunks: PDF 쪽", () => {
  const source = { id: "guide", file: "g.pdf", title: "안내서", org: "기관", url: "https://example.or.kr", checkedDate: "2026-10-15", unit: "쪽" as const };

  it("keeps the PDF pages and makes ids without spaces", () => {
    const chunks = toChunks(source, [
      { locator: "PDF 1쪽(쪽 번호 없음)", text: "체크리스트", pdfPages: [1] },
      { locator: "5쪽(별지: 계약갱신 거절통지서)", text: "별지", pdfPages: [7] },
    ]);
    expect(chunks.map((c) => [c.id, c.locator, c.pdfPages])).toEqual([
      ["guide#PDF1쪽", "PDF 1쪽(쪽 번호 없음)", [1]],
      ["guide#5쪽", "5쪽(별지: 계약갱신 거절통지서)", [7]],
    ]);
  });
});
