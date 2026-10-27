// v0.5 체크리스트 화면에 쓰는 순수 함수: 등기부 쉬운 요약, 맨 위 요약 줄, AI 설명을 붙일 항목.
// 테스트용 가상 데이터: names, amounts and quotes below are made up.
import { describe, expect, it } from "vitest";
import type { ReviewOk } from "../src/agent/extract";
import { registrySummary } from "../src/checklist/registrySummary";
import { buildChecklist, summaryLines, topicItemNo } from "../src/checklist/status";
import { evaluate } from "../src/rules/engine";
import { DEMO_CASES, DEMO_TODAY } from "./demoCases";

const ev = (quote: string) => [{ quote, location: "가상 위치" }];
const reviewed = <T,>(value: T | null, quote = "가상 원문") => ({ value, evidence: ev(quote), needsCheck: false, reasons: [] });

const review = (patch: Partial<ReviewOk> = {}): ReviewOk => ({
  status: "ok",
  owners: reviewed([{ role: "소유자", name: "가상소유자", share: null }], "소유자 가상소유자"),
  address: reviewed(null),
  houseType: reviewed("apartment"),
  area: reviewed(59.87),
  ownershipTransfer: reviewed(null),
  titleIssues: { ...reviewed([], "갑구 원문"), noIssues: true },
  mortgages: [
    { creditor: "가상은행", originalWon: 240_000_000, finalWon: 240_000_000, finalManwon: 24000, changed: false,
      evidence: ev("근저당권설정 채권최고액 금240,000,000원"), needsCheck: false, reasons: [] },
  ],
  mortgageTotal: reviewed(24000),
  tenancies: [],
  cancelled: [],
  ...patch,
});

const row = (r: ReturnType<typeof registrySummary>, label: string) => r.find((x) => x.label === label)!;

describe("등기부 쉬운 요약", () => {
  it("shows 소유자, 근저당 건수와 합계, 갑구 위험 기록, 전세권·임차권등기 in that order", () => {
    expect(registrySummary(review()).map((r) => r.label)).toEqual(["소유자", "근저당", "갑구 위험 기록", "전세권·임차권등기"]);
  });

  it("puts the 원문 근거 next to each value", () => {
    const r = registrySummary(review());
    expect(row(r, "소유자").value).toBe("가상소유자");
    expect(row(r, "소유자").evidence[0].quote).toBe("소유자 가상소유자");
    expect(row(r, "근저당").value).toBe("1건 · 채권최고액 합계 2억 4,000만원");
    expect(row(r, "근저당").evidence[0].quote).toContain("채권최고액");
  });

  it("says 없어요 when there is nothing, and 확인하지 못했어요 when it could not be read", () => {
    const none = registrySummary(review({ mortgages: [], mortgageTotal: reviewed(0) }));
    expect(row(none, "근저당").value).toBe("없어요");
    expect(row(none, "갑구 위험 기록").value).toBe("없어요");
    expect(row(none, "전세권·임차권등기").value).toBe("없어요");
    const unread = registrySummary(review({ titleIssues: { ...reviewed(null), noIssues: false } }));
    expect(row(unread, "갑구 위험 기록").value).toBe("확인하지 못했어요");
  });

  it("lists 갑구 records and 전세권·임차권등기 with the approved plain words", () => {
    const r = registrySummary(
      review({
        titleIssues: { ...reviewed(["신탁", "가압류"]), noIssues: false },
        tenancies: [{ kind: "전세권", amountWon: 200_000_000, holder: "가상전세권자", evidence: ev("전세권설정"), needsCheck: true, reasons: [] }],
      }),
    );
    expect(row(r, "갑구 위험 기록").value).toBe("신탁, 가압류");
    expect(row(r, "갑구 위험 기록").terms.map((t) => t.term)).toEqual(["갑구", "신탁등기", "가압류"]);
    expect(row(r, "전세권·임차권등기").value).toBe("전세권 1건(전세금 2억원)");
    expect(row(r, "전세권·임차권등기").terms.map((t) => t.term)).toEqual(["을구", "전세권"]);
    expect(row(r, "근저당").terms.map((t) => t.term)).toEqual(["을구", "근저당권"]);
  });
});

describe("맨 위 요약 줄", () => {
  const lines = (name: keyof typeof DEMO_CASES) =>
    summaryLines(buildChecklist(evaluate(DEMO_CASES[name], DEMO_TODAY), { contract: { agent: false } }).summary);

  it("안전 사례 uses the approved sentence", () => {
    expect(lines("safe")).toEqual(["확인한 항목에서는 위험이 보이지 않았어요 · 직접 확인할 항목 12개가 남았어요"]);
  });

  it("with ⚠, names 위험·주의 in words and still counts what is left", () => {
    expect(lines("trust")).toEqual(["⚠ 걸린 항목 3개 (위험 1 · 주의 2) · 직접 확인할 항목 13개가 남았어요"]);
    expect(lines("kkangtong")[0]).toBe("⚠ 걸린 항목 3개 (위험 2 · 가입 가능성 낮음 1) · 직접 확인할 항목 12개가 남았어요");
  });

  it("adds a line for ✏️ items", () => {
    const s = buildChecklist(evaluate({ ...DEMO_CASES.safe, marketPrice: undefined }, DEMO_TODAY), { contract: { agent: false } })
      .summary;
    expect(summaryLines(s)).toContain("✏️ 값을 넣으면 확인할 수 있는 항목 3개가 있어요");
  });
});

describe("AI 쉬운 설명을 붙일 항목", () => {
  it.each([
    ["jeonseRatio", 1],
    ["seniorBurden", 2],
    ["titleIssues", 2],
    ["recentTransfer", 2],
    ["tenancy:전세권", 2],
    ["tenancy:임차권", 2],
    ["guarantee", 5],
    ["landlord", 8],
    ["address", 8],
    ["basics", null],
  ] as const)("%s -> %s", (topicId, no) => {
    expect(topicItemNo(topicId)).toBe(no);
  });
});
