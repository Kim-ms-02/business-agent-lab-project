// v0.5 step 8 fixes: how each topic's result is worded for the AI, and the check counts that may be logged.
// 테스트용 가상 데이터: the AI answers are the hand-written fixtures; the real API is never called here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explainReport, type Ask, type AskRequest, type AiOutput, type CheckCounts } from "../src/agent/explain";
import type { EngineInput } from "../src/rules/engine";
import { DEMO_CASES, DEMO_TODAY, TRUST_TENANCIES } from "./demoCases";

type CaseName = keyof typeof DEMO_CASES;
const saved = (name: CaseName): AiOutput =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", `fake-explain-${name}.json`), "utf8")).response;
const args = (name: CaseName) => ({
  input: DEMO_CASES[name] as EngineInput,
  today: DEMO_TODAY,
  tenancies: name === "trust" ? TRUST_TENANCIES : [],
});

function fakeAsk(answers: (AiOutput | string)[]) {
  const requests: AskRequest[] = [];
  const ask: Ask = async (req) => {
    requests.push(structuredClone(req));
    const a = answers[Math.min(requests.length - 1, answers.length - 1)];
    return { text: typeof a === "string" ? a : JSON.stringify(a), usage: { inputTokens: 1, outputTokens: 1 } };
  };
  return { ask, requests };
}

const addSentence = (out: AiOutput, topicId: string, text: string, sources: string[]): AiOutput => ({
  topics: out.topics.map((t) => (t.topicId === topicId ? { ...t, explanation: [...t.explanation, { text, sources }] } : t)),
});

describe("보증보험 경고는 등급처럼 보내지 않음", () => {
  it("words the 보증보험 topic as 가입 가능성, not as a grade", async () => {
    const { ask, requests } = fakeAsk([saved("kkangtong")]);
    await explainReport(args("kkangtong"), ask);
    const text = requests[0].messages[0].content;
    expect(text).toContain("보증보험 가입 가능성: 낮음");
    expect(text).not.toMatch(/(판정|등급)\s*:\s*경고/);
  });

  it("calls only the overall result and the rules' 안전·주의·위험 a 등급", async () => {
    const { ask, requests } = fakeAsk([saved("trust")]);
    await explainReport(args("trust"), ask);
    const text = requests[0].messages[0].content;
    expect(text).toContain("전체 등급: 위험");
    expect(text).toContain("이 규칙의 등급: 주의");
    expect(text).not.toMatch(/등급\s*:\s*확인/); // 전세권·임차권 are things to check, not grades
    expect(requests[0].system).toMatch(/'등급'이라는 말은 .*안전·주의·위험/);
  });
});

describe("다시 만들기 이유: 검사 종류별 문장 수만 기록", () => {
  it("counts each failed check per attempt", async () => {
    let bad = addSentence(saved("kkangtong"), "jeonseRatio", "전세가율이 85%예요.", ["molit-guide#16쪽"]);
    bad = addSentence(bad, "seniorBurden", "출처가 없는 문장이에요.", []);
    bad = addSentence(bad, "guarantee", "신탁원부를 보세요.", ["molit-guide#21쪽"]);
    const counts: CheckCounts[] = [];
    const { ask } = fakeAsk([bad, saved("kkangtong")]);
    await explainReport(args("kkangtong"), ask, { onCheck: (c) => counts.push(c) });
    expect(counts).toEqual([
      { attempt: 1, number: 1, noSource: 1, unknownSource: 1, format: 0 },
      { attempt: 2, number: 0, noSource: 0, unknownSource: 0, format: 0 },
    ]);
  });

  it("counts an answer that is not the agreed JSON as a format failure", async () => {
    const counts: CheckCounts[] = [];
    const { ask } = fakeAsk(["설명입니다"]);
    await expect(explainReport(args("safe"), ask, { onCheck: (c) => counts.push(c) })).rejects.toThrow();
    expect(counts).toEqual([{ attempt: 1, number: 0, noSource: 0, unknownSource: 0, format: 1 }]);
  });

  it("the counts carry no sentence text", async () => {
    const counts: CheckCounts[] = [];
    const { ask } = fakeAsk([addSentence(saved("safe"), "basics", "보증금 9억 원이에요.", ["molit-guide#22쪽"])]);
    await explainReport(args("safe"), ask, { onCheck: (c) => counts.push(c) });
    const logged = JSON.stringify(counts);
    expect(logged).not.toContain("보증금");
    expect(Object.keys(counts[0]).sort()).toEqual(["attempt", "format", "noSource", "number", "unknownSource"]);
  });
});
