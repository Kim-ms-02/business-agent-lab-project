// v0.5 체크리스트 코치: 17 items from the 국토교통부 안내서 체크리스트 (PDF 1~2쪽) and the status of each.
// Statuses of the app-checked items come only from the rule engine. 테스트용 가상 데이터: tests/demoCases.ts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, type EngineInput } from "../src/rules/engine";
import { CHECKLIST_ITEMS, EXCLUDED_ITEMS, STATUS_LABELS } from "../src/checklist/items";
import { buildChecklist, type ChecklistContext, type ItemStatus } from "../src/checklist/status";
import { GLOSSARY } from "../src/agent/content";
import { DEMO_CASES, DEMO_TODAY } from "./demoCases";

type CaseName = keyof typeof DEMO_CASES;
const withContract: ChecklistContext = { contract: { agent: false } };
const check = (input: EngineInput, ctx: ChecklistContext = withContract) =>
  buildChecklist(evaluate(input, DEMO_TODAY), ctx);
const demo = (name: CaseName, ctx: ChecklistContext = withContract) => check(DEMO_CASES[name] as EngineInput, ctx);
const statusOf = (items: { no: number; status: ItemStatus }[], no: number) => items.find((i) => i.no === no)!.status;
const kinds = (items: { no: number; status: ItemStatus }[]) =>
  Object.fromEntries(items.map((i) => [i.no, i.status.kind === "hit" ? `hit:${i.status.label}` : i.status.kind]));

const AUTO = [1, 2, 5, 8, 9];
const MANUAL = [3, 4, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17];
const allManual = Object.fromEntries(MANUAL.map((n) => [n, "manual"]));

describe("17개 항목 (승인 문구)", () => {
  it("has 17 items: 계약 전 5, 계약할 때 5, 계약 후 7, numbered 1–17", () => {
    expect(CHECKLIST_ITEMS.map((i) => i.no)).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
    const count = (stage: string) => CHECKLIST_ITEMS.filter((i) => i.stage === stage).length;
    expect([count("계약 전"), count("계약할 때"), count("계약 후")]).toEqual([5, 5, 7]);
  });

  it("marks only items 1, 2, 5, 8, 9 as checked by the app", () => {
    expect(CHECKLIST_ITEMS.filter((i) => i.auto).map((i) => i.no)).toEqual(AUTO);
  });

  it("every item cites 안내서 체크리스트 + 본문 쪽", () => {
    for (const item of CHECKLIST_ITEMS) expect(item.source).toMatch(/^안내서 체크리스트 \+ 본문 \d+(~\d+)?(·\d+)?쪽/);
    expect(CHECKLIST_ITEMS[4].source).toContain("HUG 상품개요 2쪽");
  });

  it("item 3 says the landlord's consent is needed", () => {
    expect(CHECKLIST_ITEMS[2].guide).toContain("집주인의 동의가 필요해요");
  });

  it("items 12 and 16 show the approved 대항력·우선변제권 wording", () => {
    for (const no of [12, 16]) {
      const terms = CHECKLIST_ITEMS[no - 1].terms;
      expect(terms.map((t) => t.term)).toEqual(["대항력", "우선변제권"]);
      for (const t of terms) expect(GLOSSARY).toContainEqual(t);
    }
  });

  it("every question names an official chunk that exists", () => {
    const ids = new Set(
      (JSON.parse(readFileSync(join(__dirname, "../docs/sources/chunks.json"), "utf8")).chunks as { id: string }[]).map(
        (c) => c.id,
      ),
    );
    const questions = CHECKLIST_ITEMS.flatMap((i) => i.questions);
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) expect(ids.has(q.source), q.source).toBe(true);
  });

  it("item 6's question is for the 중개사, and the do-it-yourself items have none", () => {
    expect(CHECKLIST_ITEMS[5].questions.every((q) => q.to === "중개사")).toBe(true);
    for (const no of [11, 12, 15, 16, 17]) expect(CHECKLIST_ITEMS[no - 1].questions).toEqual([]);
  });

  it("lists the 8 심화 items left out, with their pages, for 알려진 한계", () => {
    expect(EXCLUDED_ITEMS).toHaveLength(8);
    for (const e of EXCLUDED_ITEMS) expect(e.pages).toMatch(/^\d+(~\d+)?쪽$/);
  });

  it("has the four status labels", () => {
    expect(STATUS_LABELS).toEqual({
      ok: "✅ 앱이 확인함",
      hit: "⚠ 걸림",
      input: "✏️ 입력하면 확인할 수 있어요",
      manual: "❓ 직접 확인",
    });
  });
});

describe("데모 사례별 상태", () => {
  it("안전 사례: 1·2·5·8·9 ✅, the rest ❓", () => {
    expect(kinds(demo("safe").items)).toEqual({ ...allManual, 1: "ok", 2: "ok", 5: "ok", 8: "ok", 9: "ok" });
  });

  it("깡통전세 사례: 1·2 ⚠ 위험, 5 ⚠ 가입 가능성 낮음", () => {
    expect(kinds(demo("kkangtong").items)).toEqual({
      ...allManual,
      1: "hit:위험",
      2: "hit:위험",
      5: "hit:가입 가능성 낮음",
      8: "ok",
      9: "ok",
    });
  });

  it("신탁 사례: 2 권리관계 ⚠, 5 보증보험 ❓ (HUG에 직접 확인)", () => {
    const items = demo("trust").items;
    expect(kinds(items)).toEqual({ ...allManual, 1: "hit:주의", 2: "hit:위험", 5: "manual", 8: "hit:주의", 9: "ok" });
    expect(statusOf(items, 2).kind).toBe("hit");
    const guarantee = statusOf(items, 5);
    expect(guarantee.kind).toBe("manual");
    expect(guarantee.message).toContain("HUG에 직접 확인");
  });

  it("신탁 사례 item 2 adds the guide's 신탁 note and the 신탁 question", () => {
    const item = demo("trust").items[1];
    expect(item.status.reasons.join(" ")).toContain("신탁등기는 전문가와 함께 확인하세요");
    expect(item.questions.map((q) => q.text).join(" ")).toContain("신탁원부");
  });
});

describe("계약서와 대리인", () => {
  it("without a contract, 8 and 9 are ❓ 계약서를 올리면 확인할 수 있어요", () => {
    const items = demo("safe", { contract: null }).items;
    for (const no of [8, 9]) {
      expect(statusOf(items, no).kind).toBe("manual");
      expect(statusOf(items, no).message).toBe("계약서를 올리면 확인할 수 있어요");
    }
  });

  it("a 대리인 on the contract -> 9 ⚠ 확인 필요", () => {
    const items = check({ ...DEMO_CASES.safe, isAgentContract: true }, { contract: { agent: true } }).items;
    expect(kinds(items)[9]).toBe("hit:확인 필요");
  });

  it("an empty 대리인 칸 -> 9 ✅", () => {
    expect(statusOf(demo("safe").items, 9).kind).toBe("ok");
  });

  it("임대인 ≠ 소유자 -> 8 ⚠ 위험", () => {
    expect(kinds(check({ ...DEMO_CASES.safe, landlordNames: ["김철수"] }).items)[8]).toBe("hit:위험");
  });

  it("주소 불일치 is shown under item 8 as 주의", () => {
    const items = check({ ...DEMO_CASES.safe, contractUnit: { jibun: "9101", dong: "101", ho: "1204" } }).items;
    expect(kinds(items)[8]).toBe("hit:주의");
    expect(statusOf(items, 8).reasons.join(" ")).toContain("주소");
  });

  it("8 with a contract but no 등기부 소유자 -> ✏️ with what is needed", () => {
    const s = statusOf(check({ ...DEMO_CASES.safe, ownerNames: [] }).items, 8);
    expect(s.kind).toBe("input");
    expect(s.needs).toContain("등기부 소유자");
  });
});

describe("값이 빠졌을 때 ✏️", () => {
  it("no 집값 -> 1, 2, 5 ✏️ and each says what to enter", () => {
    const items = check({ ...DEMO_CASES.safe, marketPrice: undefined }).items;
    for (const no of [1, 2, 5]) {
      expect(statusOf(items, no).kind).toBe("input");
      expect(statusOf(items, no).needs).toContain("집값");
    }
  });

  it("a 갑구 압류 still shows 2 ⚠ even when the 시세 is missing", () => {
    const items = check({ ...DEMO_CASES.safe, marketPrice: undefined, titleIssues: ["압류"], noTitleIssues: false }).items;
    expect(kinds(items)[2]).toBe("hit:위험");
  });

  it("빌라 without 공시가격 -> 5 ✏️ 공시가격", () => {
    const s = statusOf(check({ ...DEMO_CASES.safe, houseType: "rowhouse" }).items, 5);
    expect(s.kind).toBe("input");
    expect(s.needs).toEqual(["공시가격"]);
  });
});

describe("판정과의 관계", () => {
  const variants: EngineInput[] = [
    ...Object.values(DEMO_CASES),
    { ...DEMO_CASES.safe, landlordNames: ["김철수"] },
    { ...DEMO_CASES.safe, contractUnit: { jibun: "1", dong: null, ho: "1" } },
    { ...DEMO_CASES.safe, titleIssues: ["가압류"], noTitleIssues: false },
  ];

  it("every rule the engine hit is shown in some item", () => {
    for (const input of variants) {
      const result = evaluate(input, DEMO_TODAY);
      const shown = buildChecklist(result, withContract).items.flatMap((i) => i.status.reasons);
      for (const hit of result.hits) expect(shown).toContain(hit.reason);
    }
  });

  it("does not change the engine result", () => {
    const result = evaluate(DEMO_CASES.trust, DEMO_TODAY);
    const before = structuredClone(result);
    buildChecklist(result, withContract);
    expect(result).toEqual(before);
  });

  it("✅ never promises 안전", () => {
    for (const input of variants) {
      for (const item of check(input).items) {
        if (item.status.kind === "ok") expect(item.status.message).not.toContain("안전");
      }
    }
  });
});

describe("맨 위 요약", () => {
  it("안전 사례: no ⚠, says so and counts what is left to check", () => {
    const { summary } = demo("safe");
    expect(summary.counts).toEqual({ ok: 5, hit: 0, input: 0, manual: 12 });
    expect(summary.message).toBe("확인한 항목에서는 위험이 보이지 않았어요 · 직접 확인할 항목 12개가 남았어요");
  });

  it("신탁 사례: counts ⚠ by 위험·주의 and gives no 'no risk' message", () => {
    const { summary } = demo("trust");
    expect(summary.counts).toEqual({ ok: 1, hit: 3, input: 0, manual: 13 });
    expect(summary.hitLabels).toEqual({ 위험: 1, 주의: 2 });
    expect(summary.message).toBeNull();
  });
});

describe("을구 전세권·임차권등기 (2번)", () => {
  const TENANCY_LINE = "을구에 전세권·임차권등기가 있어요. 직접 확인하세요";

  it.each(["전세권", "임차권"] as const)("no ⚠ but a %s등기 -> 2 ❓ instead of ✅, grade unchanged", (kind) => {
    const result = evaluate(DEMO_CASES.safe, DEMO_TODAY);
    const items = buildChecklist(result, { ...withContract, tenancies: [{ kind }] }).items;
    const s = statusOf(items, 2);
    expect(s.kind).toBe("manual");
    expect(s.message).toBe(TENANCY_LINE);
    expect(items[1].questions.map((q) => q.text)).toContain(
      kind === "전세권" ? "을구에 남은 전세권은 언제 말소되나요?" : "이전 세입자가 보증금을 돌려받지 못해 임차권등기를 한 것인가요? 지금은 돌려받았나요?",
    );
    expect(result.grade).toBe("안전");
  });

  it("2 already ⚠ -> stays ⚠ and the 을구 line is added", () => {
    const items = demo("trust", { ...withContract, tenancies: [{ kind: "전세권" }] }).items;
    expect(kinds(items)[2]).toBe("hit:위험");
    expect(statusOf(items, 2).reasons).toContain(TENANCY_LINE);
  });

  it("no 전세권·임차권등기 -> 2 stays ✅", () => {
    expect(statusOf(demo("safe", { ...withContract, tenancies: [] }).items, 2).kind).toBe("ok");
  });
});

describe("대리인은 9번에서만 ⚠", () => {
  const agent: ChecklistContext = { contract: { agent: true } };

  it("대리인 only -> 8 ✅, 9 ⚠ 확인 필요, counted once; the grade is unchanged", () => {
    const result = evaluate({ ...DEMO_CASES.safe, isAgentContract: true }, DEMO_TODAY);
    const { items, summary } = buildChecklist(result, agent);
    expect(kinds(items)[8]).toBe("ok");
    expect(kinds(items)[9]).toBe("hit:확인 필요");
    expect(statusOf(items, 9).reasons.join(" ")).toContain("대리인");
    expect(summary.counts.hit).toBe(1);
    expect(result.grade).toBe("주의");
  });

  it("대리인 + 다른 이름 -> 8 ⚠ 위험 without the 대리인 line, 9 ⚠ 확인 필요", () => {
    const items = check({ ...DEMO_CASES.safe, isAgentContract: true, landlordNames: ["김철수"] }, agent).items;
    expect(kinds(items)[8]).toBe("hit:위험");
    expect(statusOf(items, 8).reasons.join(" ")).not.toContain("대리인이 계약해요");
    expect(kinds(items)[9]).toBe("hit:확인 필요");
  });

  it("대리인 + 주소 불일치 -> 8 ⚠ 주의 for the address only", () => {
    const items = check(
      { ...DEMO_CASES.safe, isAgentContract: true, contractUnit: { jibun: "9101", dong: "101", ho: "1204" } },
      agent,
    ).items;
    expect(kinds(items)[8]).toBe("hit:주의");
    expect(statusOf(items, 8).reasons.join(" ")).toContain("주소");
    expect(statusOf(items, 8).reasons.join(" ")).not.toContain("대리인이 계약해요");
  });
});
