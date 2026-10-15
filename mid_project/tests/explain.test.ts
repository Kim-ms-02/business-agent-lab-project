// 테스트용 가상 데이터: chunks and AI answers below are made up; engine results come from the demo cases.
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/rules/engine";
import type { Chunk } from "../src/agent/retrieve";
import {
  buildTopics,
  checkOutput,
  extractNumbers,
  finalizeReport,
  generateChecked,
  visibleGlossary,
  type AiOutput,
  type TopicContext,
} from "../src/agent/explain";
import { DEMO_CASES, DEMO_TODAY, TRUST_TENANCIES } from "./demoCases";

const result = (name: keyof typeof DEMO_CASES) => evaluate(DEMO_CASES[name], DEMO_TODAY);

const chunk = (id: string, text: string): Chunk => ({
  id,
  sourceId: id.split("#")[0],
  title: "가상 안내서",
  org: "가상기관",
  url: "https://example.go.kr",
  checkedDate: "2026-10-15",
  locator: id.split("#")[1],
  text,
});

describe("extractNumbers", () => {
  it.each([
    ["전세가율이 88.9%예요.", [{ kind: "pct", value: 88.9 }]],
    ["보증금 4억 원", [{ kind: "money", value: 40000 }]],
    ["4억 5천만 원", [{ kind: "money", value: 45000 }]],
    ["6억4천만원", [{ kind: "money", value: 64000 }]],
    ["2억 4,000만 원", [{ kind: "money", value: 24000 }]],
    ["40,000만원", [{ kind: "money", value: 40000 }]],
    ["400,000,000원", [{ kind: "money", value: 40000 }]],
    ["4.5억 원", [{ kind: "money", value: 45000 }]],
    ["5,500만원", [{ kind: "money", value: 5500 }]],
    ["2026년 8월 20일", [{ kind: "date", value: "2026-08-20" }]],
    ["2026-08-20", [{ kind: "date", value: "2026-08-20" }]],
    ["2018년에", [{ kind: "year", value: 2018 }]],
    ["3개월 안에", [{ kind: "months", value: 3 }]],
    ["제3조의2에 따라", [{ kind: "article", value: "3의2" }]],
    ["1순위로", [{ kind: "num", value: 1 }]],
    ["숫자가 없어요.", []],
  ])("%j", (text, numbers) => {
    expect(extractNumbers(text).map(({ kind, value }) => ({ kind, value }))).toEqual(numbers);
  });

  it("reads several numbers in one sentence", () => {
    expect(extractNumbers("보증금 4억 원은 시세 4억 5천만 원의 88.9%예요.").map((n) => n.kind)).toEqual(["money", "money", "pct"]);
  });
});

describe("buildTopics", () => {
  it("safe case -> only the basic checklist topic", () => {
    expect(buildTopics(result("safe"), []).map((t) => t.id)).toEqual(["basics"]);
  });

  it("깡통전세 -> both ratio rules and the 보증보험 warning, with the engine's numbers as facts", () => {
    const topics = buildTopics(result("kkangtong"), []);
    expect(topics.map((t) => t.id)).toEqual(["jeonseRatio", "seniorBurden", "guarantee"]);
    const jeonse = topics[0].facts.join(" ");
    expect(jeonse).toContain("88.9%");
    expect(jeonse).toContain("4억 원");
    expect(jeonse).toContain("4억 5,000만 원");
    expect(topics[1].facts.join(" ")).toContain("142.2%");
  });

  it("신탁 -> every hit plus the 전세권 from the 등기부", () => {
    const topics = buildTopics(result("trust"), TRUST_TENANCIES);
    expect(topics.map((t) => t.id)).toEqual(["jeonseRatio", "titleIssues", "recentTransfer", "landlord", "tenancy:전세권"]);
    expect(topics[1].facts.join(" ")).toContain("신탁");
    expect(topics[4].facts.join(" ")).toContain("2억 원");
  });

  it("never passes names or the actual 동·호수 to the AI", () => {
    const mismatch = evaluate({ ...DEMO_CASES.safe, landlordNames: ["김철수"], contractUnit: { jibun: "9101", dong: "101", ho: "1204" } }, DEMO_TODAY);
    const facts = buildTopics(mismatch, []).flatMap((t) => t.facts).join(" ");
    expect(facts).toContain("집주인 불일치");
    expect(facts).toContain("호수");
    for (const secret of ["김철수", "홍길동", "1204", "1203", "9101"]) expect(facts).not.toContain(secret);
  });
});

describe("checkOutput", () => {
  const ctx: TopicContext[] = [
    {
      topic: { id: "jeonseRatio", title: "전세가율", grade: "위험", facts: ["전세가율 88.9%", "보증금 4억 원(40,000만원)"] },
      chunks: [
        chunk("guide#2쪽", "전세가율이 높으면 집값이 떨어질 때 보증금을 돌려받기 어려워요."),
        chunk("law#제8조", "제8조(보증금 중 일정액의 보호) 소액임차인은 5,500만원까지 먼저 돌려받는다."),
      ],
    },
  ];
  const out = (text: string, sources: string[]): AiOutput => ({
    topics: [{ topicId: "jeonseRatio", explanation: [{ text, sources }], questions: [] }],
  });
  const problems = (o: AiOutput) => checkOutput(o, ctx).map((p) => p.reasons.join(" "));

  it("accepts a sourced sentence whose numbers are in the result (반올림 포함)", () => {
    expect(problems(out("보증금 4억 원이 시세의 88.9%라서 위험해요.", ["guide#2쪽"]))).toEqual([]);
    expect(problems(out("전세가율이 약 89%예요.", ["guide#2쪽"]))).toEqual([]);
    expect(problems(out("보증금 40,000만원은 많은 편이에요.", ["guide#2쪽"]))).toEqual([]);
  });

  it("rejects a sentence without a source", () => {
    expect(problems(out("위험해요.", []))[0]).toContain("출처");
  });

  it("rejects a source that was not given for this topic", () => {
    expect(problems(out("위험해요.", ["other#1쪽"]))[0]).toContain("받지 않은 출처");
  });

  it("rejects a number that is not in the result", () => {
    expect(problems(out("전세가율이 90%예요.", ["guide#2쪽"]))[0]).toContain("90%");
    expect(problems(out("보증금 5억 원이에요.", ["guide#2쪽"]))[0]).toContain("5억");
  });

  it("allows a number from a chunk only when that chunk is cited", () => {
    expect(problems(out("소액임차인은 5,500만원까지 먼저 돌려받아요.", ["law#제8조"]))).toEqual([]);
    expect(problems(out("소액임차인은 5,500만원까지 먼저 돌려받아요.", ["guide#2쪽"]))[0]).toContain("5,500만원");
  });

  it("checks questions the same way", () => {
    const o: AiOutput = { topics: [{ topicId: "jeonseRatio", explanation: [], questions: [{ text: "근저당을 갚을 수 있나요?", sources: [] }] }] };
    expect(checkOutput(o, ctx)[0]).toMatchObject({ topicId: "jeonseRatio", part: "questions", index: 0 });
  });
});

describe("generateChecked (다시 만들기)", () => {
  const ctx: TopicContext[] = [
    { topic: { id: "jeonseRatio", title: "전세가율", grade: "위험", facts: ["전세가율 88.9%"] }, chunks: [chunk("guide#2쪽", "전세가율 안내")] },
  ];
  const good = { text: "전세가율이 88.9%예요.", sources: ["guide#2쪽"] };
  const bad = { text: "전세가율이 95%예요.", sources: ["guide#2쪽"] };
  const answer = (explanation: { text: string; sources: string[] }[]): AiOutput => ({
    topics: [{ topicId: "jeonseRatio", explanation, questions: [] }],
  });

  it("asks again with the problems as feedback and keeps the fixed answer", async () => {
    const feedbacks: string[][] = [];
    const answers = [answer([good, bad]), answer([good])];
    const r = await generateChecked(async (feedback) => {
      feedbacks.push(feedback);
      return answers.shift()!;
    }, ctx, 2);
    expect(r.attempts).toBe(2);
    expect(feedbacks[0]).toEqual([]);
    expect(feedbacks[1].join(" ")).toContain("95%");
    expect(r.output.topics[0].explanation).toEqual([good]);
    expect(r.dropped).toEqual([]);
  });

  it("stops after the maximum retries and drops the sentences that are still wrong", async () => {
    let calls = 0;
    const r = await generateChecked(async () => {
      calls++;
      return answer([good, bad]);
    }, ctx, 2);
    expect(calls).toBe(3); // first try + 2 retries
    expect(r.output.topics[0].explanation).toEqual([good]);
    expect(r.dropped.map((d) => d.text)).toEqual([bad.text]);
  });
});

describe("finalizeReport", () => {
  const withDocs: TopicContext = {
    topic: { id: "titleIssues", title: "갑구 위험 기재", grade: "위험", facts: ["갑구 기재: 신탁"] },
    chunks: [chunk("guide#3쪽", "신탁된 집은 수탁자 동의가 필요해요.")],
  };
  const noDocs: TopicContext = { topic: { id: "recentTransfer", title: "최근 소유권 이전", grade: "주의", facts: [] }, chunks: [] };
  const defaults = { titleIssues: ["신탁회사(수탁자)의 동의서를 받을 수 있나요?"], recentTransfer: ["언제 집을 사셨나요?"] };

  it("a topic without documents says so and gets nothing made up", () => {
    const [, r] = finalizeReport([withDocs, noDocs], { topics: [] }, defaults);
    expect(r).toMatchObject({ status: "no-docs", message: "관련 공식 안내를 찾지 못했어요", explanation: [], questions: [] });
  });

  it("a topic whose sentences were all dropped says the explanation could not be made", () => {
    const [r] = finalizeReport([withDocs], { topics: [] }, defaults);
    expect(r.status).toBe("no-explanation");
    expect(r.message).toBe("설명을 만들지 못했어요");
  });

  it("fills in the approved default question, sourced from the topic's best chunk, when none survived", () => {
    const [r] = finalizeReport([withDocs], { topics: [] }, defaults);
    expect(r.questions).toEqual([{ text: "신탁회사(수탁자)의 동의서를 받을 수 있나요?", sources: ["guide#3쪽"], fallback: true }]);
  });

  it("keeps the AI's valid sentences and questions", () => {
    const output: AiOutput = {
      topics: [
        {
          topicId: "titleIssues",
          explanation: [{ text: "신탁된 집이에요.", sources: ["guide#3쪽"] }],
          questions: [{ text: "신탁원부를 보여 줄 수 있나요?", sources: ["guide#3쪽"] }],
        },
      ],
    };
    const [r] = finalizeReport([withDocs], output, defaults);
    expect(r.status).toBe("ok");
    expect(r.explanation).toHaveLength(1);
    expect(r.questions).toEqual([{ text: "신탁원부를 보여 줄 수 있나요?", sources: ["guide#3쪽"], fallback: false }]);
  });
});

describe("visibleGlossary", () => {
  it("shows a term only when its source chunk exists", () => {
    const glossary = [
      { term: "근저당", plain: "집을 담보로 받은 대출", source: "guide#2쪽" },
      { term: "가등기", plain: "나중을 위해 미리 해 둔 등기", source: "missing#1쪽" },
    ];
    expect(visibleGlossary(glossary, [chunk("guide#2쪽", "근저당 안내")]).map((g) => g.term)).toEqual(["근저당"]);
  });
});
