// v0.5 step 8: the explanation request and its checks, with saved example answers (tests/fixtures/fake-explain-*.json).
// 테스트용 가상 데이터: the AI answers are hand-written; the real API is never called here.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXPLAIN_MAX_RETRIES } from "../src/agent/config";
import {
  EXPLAIN_FAILED_MESSAGE,
  EXPLAIN_TIMEOUT_MESSAGE,
  ExplainError,
  explainReport,
  parseAiOutput,
  parseExplainBody,
  type Ask,
  type AskRequest,
  type AiOutput,
} from "../src/agent/explain";
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
const usage = { inputTokens: 1000, outputTokens: 200 };

// A fake Claude that answers from a list and records every request it got.
function fakeAsk(answers: (AiOutput | string | Error)[]) {
  const requests: AskRequest[] = [];
  const ask: Ask = async (req) => {
    requests.push(structuredClone(req));
    const a = answers[Math.min(requests.length - 1, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { text: typeof a === "string" ? a : JSON.stringify(a), usage };
  };
  return { ask, requests };
}

const withSentence = (out: AiOutput, topicId: string, text: string, sources: string[]): AiOutput => ({
  topics: out.topics.map((t) => (t.topicId === topicId ? { ...t, explanation: [...t.explanation, { text, sources }] } : t)),
});

afterEach(() => vi.restoreAllMocks());

describe("explainReport: what the AI gets", () => {
  // Distinct made-up names and 지번·동·호수 so any leak is easy to spot.
  const sentinel: EngineInput = {
    ...DEMO_CASES.trust,
    landlordNames: ["가상임대인갑"],
    ownerNames: ["가상소유자을"],
    contractUnit: { jibun: "98765", dong: "707", ho: "4321" },
    registryUnit: { jibun: "98764", dong: "708", ho: "4322" },
    isAgentContract: true,
  };

  it.each(["safe", "kkangtong", "trust"] as const)("%s: no names, 지번·동·호수 or region code in the request", async (name) => {
    const { ask, requests } = fakeAsk([saved(name)]);
    await explainReport(args(name), ask);
    const sent = JSON.stringify(requests);
    const input = DEMO_CASES[name] as EngineInput;
    for (const s of [...(input.landlordNames ?? []), ...(input.ownerNames ?? []), input.lawdCd ?? "", input.contractUnit?.jibun ?? ""]) {
      expect(sent).not.toContain(s);
    }
  });

  it("leaves out names, 지번·동·호수 and region code even when they differ", async () => {
    const { ask, requests } = fakeAsk([{ topics: [] }]);
    await explainReport({ input: sentinel, today: DEMO_TODAY, tenancies: TRUST_TENANCIES }, ask);
    const sent = JSON.stringify(requests);
    for (const s of ["가상임대인갑", "가상소유자을", "98765", "98764", "4321", "4322", "707", "708", "41135"]) {
      expect(sent).not.toContain(s);
    }
  });

  it("sends the grade, the rule facts and the found chunks", async () => {
    const { ask, requests } = fakeAsk([saved("kkangtong")]);
    await explainReport(args("kkangtong"), ask);
    const sent = JSON.stringify(requests[0]);
    for (const s of ["위험", "88.9%", "142.2%", "molit-guide#16쪽", "hug-guarantee#1쪽"]) expect(sent).toContain(s);
  });

  it("logs nothing (the route logs token counts only)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { ask } = fakeAsk([withSentence(saved("trust"), "jeonseRatio", "전세가율이 99%예요.", ["molit-guide#16쪽"])]);
    await explainReport(args("trust"), ask);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("explainReport: checked answers", () => {
  it.each(["safe", "kkangtong", "trust"] as const)("%s: a good saved answer passes on the first try", async (name) => {
    const { ask, requests } = fakeAsk([saved(name)]);
    const r = await explainReport(args(name), ask);
    expect(requests).toHaveLength(1);
    expect(r.attempts).toBe(1);
    expect(r.dropped).toBe(0);
    expect(r.topics.every((t) => t.status === "ok")).toBe(true);
    expect(r.usage).toEqual(usage);
  });

  it("asks again with the problems, and keeps the fixed answer", async () => {
    const bad = withSentence(saved("kkangtong"), "jeonseRatio", "전세가율이 85%예요.", ["molit-guide#16쪽"]);
    const { ask, requests } = fakeAsk([bad, saved("kkangtong")]);
    const r = await explainReport(args("kkangtong"), ask);
    expect(r.attempts).toBe(2);
    expect(r.dropped).toBe(0);
    expect(r.usage).toEqual({ inputTokens: 2000, outputTokens: 400 });
    // The second request carries the first answer and what was wrong with it.
    const second = JSON.stringify(requests[1].messages);
    expect(second).toContain("전세가율이 85%예요.");
    expect(second).toContain("85%");
  });

  it(`stops after ${EXPLAIN_MAX_RETRIES} more tries and drops the sentences that are still wrong`, async () => {
    const bad = withSentence(saved("kkangtong"), "seniorBurden", "출처 없는 문장이에요.", []);
    const { ask, requests } = fakeAsk([bad]);
    const r = await explainReport(args("kkangtong"), ask);
    expect(requests).toHaveLength(1 + EXPLAIN_MAX_RETRIES);
    expect(r.attempts).toBe(1 + EXPLAIN_MAX_RETRIES);
    expect(r.dropped).toBe(1);
    const senior = r.topics.find((t) => t.topic.id === "seniorBurden")!;
    expect(senior.explanation.map((s) => s.text)).not.toContain("출처 없는 문장이에요.");
    expect(senior.explanation).toHaveLength(2);
  });

  it("drops a sentence citing a chunk that was not found for its topic", async () => {
    const bad = withSentence(saved("trust"), "landlord", "신탁원부를 확인하세요.", ["molit-guide#21쪽"]);
    const { ask } = fakeAsk([bad]);
    const r = await explainReport(args("trust"), ask);
    expect(r.topics.find((t) => t.topic.id === "landlord")!.explanation.map((s) => s.text)).not.toContain("신탁원부를 확인하세요.");
  });

  it("shows only glossary terms whose chunk was found", async () => {
    const { ask } = fakeAsk([saved("safe")]);
    const r = await explainReport(args("safe"), ask);
    expect(r.glossary.map((g) => g.term)).toEqual(expect.arrayContaining(["대항력", "우선변제권", "확정일자"]));
    expect(r.glossary.map((g) => g.term)).not.toContain("가처분");
  });

  it("falls back to the approved default questions when the AI gave none", async () => {
    const noQuestions: AiOutput = { topics: saved("safe").topics.map((t) => ({ ...t, questions: [] })) };
    const { ask } = fakeAsk([noQuestions]);
    const r = await explainReport(args("safe"), ask);
    expect(r.topics[0].questions).toEqual([
      { text: "계약 전에 등기부를 함께 보고, 보증보험 가입이 되는 집인지 확인해 주실 수 있나요?", sources: ["molit-press-333#2쪽"], fallback: true },
    ]);
  });
});

describe("explainReport: slow or failed calls", () => {
  it("a timeout on the first call gives the plain timeout message", async () => {
    const { ask } = fakeAsk([new ExplainError("timeout")]);
    await expect(explainReport(args("safe"), ask)).rejects.toThrow(EXPLAIN_TIMEOUT_MESSAGE);
  });

  it("any other failure on the first call gives the plain failure message", async () => {
    const { ask } = fakeAsk([new Error("socket hang up")]);
    await expect(explainReport(args("safe"), ask)).rejects.toThrow(EXPLAIN_FAILED_MESSAGE);
  });

  it("an answer that is not the expected JSON is a failure", async () => {
    const { ask } = fakeAsk(["설명입니다"]);
    await expect(explainReport(args("safe"), ask)).rejects.toThrow(EXPLAIN_FAILED_MESSAGE);
  });

  it("if a retry fails, the first answer is kept without its bad sentences", async () => {
    const bad = withSentence(saved("kkangtong"), "jeonseRatio", "전세가율이 85%예요.", ["molit-guide#16쪽"]);
    const { ask } = fakeAsk([bad, new ExplainError("timeout")]);
    const r = await explainReport(args("kkangtong"), ask);
    expect(r.attempts).toBe(2);
    expect(r.dropped).toBe(1);
    expect(r.topics[0].explanation).toHaveLength(3);
  });

  it("the messages are plain Korean and say the result is still there", () => {
    expect(EXPLAIN_TIMEOUT_MESSAGE).toMatch(/판정 결과는 그대로/);
    expect(EXPLAIN_FAILED_MESSAGE).toMatch(/판정 결과는 그대로/);
  });
});

describe("parseAiOutput", () => {
  it("reads a well-formed answer", () => {
    expect(parseAiOutput(JSON.stringify(saved("safe")))).toEqual(saved("safe"));
  });

  it.each([
    ["not JSON", "설명"],
    ["no topics", "{}"],
    ["sources not a list", JSON.stringify({ topics: [{ topicId: "basics", explanation: [{ text: "a", sources: "x" }], questions: [] }] })],
    ["text missing", JSON.stringify({ topics: [{ topicId: "basics", explanation: [{ sources: [] }], questions: [] }] })],
  ])("rejects %s", (_label, text) => {
    expect(parseAiOutput(text)).toBeNull();
  });
});

describe("parseExplainBody (/api/explain 요청 검사)", () => {
  const body = { input: DEMO_CASES.trust, today: DEMO_TODAY, tenancies: TRUST_TENANCIES };

  it("accepts the form values, the date and the 등기부 전세권·임차권", () => {
    expect(parseExplainBody(body)).toEqual({ ok: true, value: body });
  });

  it.each([
    ["not an object", null],
    ["input missing", { ...body, input: undefined }],
    ["bad date", { ...body, today: "2026/10/15" }],
    ["bad tenancy kind", { ...body, tenancies: [{ kind: "근저당", amountWon: 1 }] }],
    ["tenancies not a list", { ...body, tenancies: "전세권" }],
  ])("rejects %s", (_label, b) => {
    expect(parseExplainBody(b).ok).toBe(false);
  });
});
