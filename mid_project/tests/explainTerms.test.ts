// v0.5 step 8 fix: the AI must not write its own meaning of a glossary term; the approved wording in
// content.ts is shown instead. 테스트용 가상 데이터: the sentences below are made up.
import { describe, expect, it } from "vitest";
import { checkOutput, explainReport, termDefinitions, type Ask, type AskRequest, type TopicContext } from "../src/agent/explain";
import type { EngineInput } from "../src/rules/engine";
import type { Chunk } from "../src/agent/retrieve";
import { DEMO_CASES, DEMO_TODAY } from "./demoCases";

describe("termDefinitions (용어 뜻을 새로 쓴 문장)", () => {
  it.each([
    // 1. "용어란 …", "…을 용어라고 해요"
    ["깡통전세란 대출금과 보증금이 집값을 넘는 집이에요.", ["깡통전세"]],
    ["이런 집을 깡통전세라고 해요.", ["깡통전세"]],
    ["집값을 넘는 집을 깡통전세라고 하고, 피해의 주요 원인이에요.", ["깡통전세"]],
    // 2. "용어는 … 권리·힘·것·등기·절차·비율·상품·곳이에요", "용어는 … 뜻이에요/말해요"
    ["전세권은 전세금을 먼저 돌려받을 수 있는 권리예요.", ["전세권"]],
    ["가처분은 법원이 미리 막아 둔 것을 말해요.", ["가처분"]],
    ["갑구는 소유자와 소유권을 제한하는 권리를 보여 주는 곳이에요.", ["갑구"]],
    // 3. "…하는 힘(용어)"
    ["보증금을 먼저 돌려받을 수 있는 힘(대항력, 우선변제권)이 생겨요.", ["대항력", "우선변제권"]],
    // 4. "~하면 용어이/가 생겨요/생깁니다/발생해요"
    ["전입신고와 확정일자를 받으면 대항력과 우선변제권이 생겨요.", ["대항력", "우선변제권"]],
    ["입주와 전입신고를 마치면 다음 날부터 대항력이 생깁니다.", ["대항력"]],
    ["확정일자까지 받으면 우선변제권이 발생해요.", ["우선변제권"]],
  ])("%s", (text, terms) => {
    expect(termDefinitions(text)).toEqual(terms);
  });

  it.each([
    "전입신고와 확정일자를 꼭 받으세요.",
    "계약 후에는 확정일자를 받고, 이사 당일 전입신고를 마치세요.",
    "을구에 있는 근저당권 채권최고액 합계가 커서 위험으로 나왔어요.",
    "을구에 남은 전세권은 언제 말소되나요?",
    "잔금 전에 등기부를 다시 떼어 압류가 생기지 않았는지 확인하세요.",
    "갑구에 신탁이 적혀 있어요.",
    "근저당권을 잔금 전에 갚고 말소해 달라고 요청할 수 있어요.",
  ])("passes a sentence that only says what to do or what is there: %s", (text) => {
    expect(termDefinitions(text)).toEqual([]);
  });
});

describe("checkOutput: 용어 뜻을 새로 쓴 문장은 검사에 걸림", () => {
  const chunk: Chunk = {
    id: "guide#22쪽", sourceId: "guide", title: "가상 안내서", org: "가상 기관",
    url: "https://example.go.kr", checkedDate: "2026-10-15", locator: "22쪽", text: "대항력과 우선변제권 안내",
  };
  const ctx: TopicContext = { topic: { id: "basics", title: "계약 전 기본 확인", grade: "기본", facts: [] }, chunks: [chunk] };

  it("names the term and says the plain meaning is shown separately", () => {
    const problems = checkOutput(
      {
        topics: [{
          topicId: "basics",
          explanation: [
            { text: "전입신고와 확정일자를 받으면 대항력과 우선변제권이 생겨요.", sources: ["guide#22쪽"] },
            { text: "전입신고와 확정일자를 꼭 받으세요.", sources: ["guide#22쪽"] },
          ],
          questions: [],
        }],
      },
      [ctx],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].index).toBe(0);
    expect(problems[0].reasons.join(" ")).toMatch(/용어 뜻을 새로 썼어요.*대항력/);
  });
});

describe("explainReport: 용어 검사", () => {
  const answer = (text: string) =>
    JSON.stringify({ topics: [{ topicId: "basics", explanation: [{ text, sources: ["molit-guide#22쪽"] }], questions: [] }] });
  const run = async (texts: string[]) => {
    const requests: AskRequest[] = [];
    const ask: Ask = async (req) => {
      requests.push(structuredClone(req));
      return { text: answer(texts[Math.min(requests.length - 1, texts.length - 1)]), usage: { inputTokens: 1, outputTokens: 1 } };
    };
    const terms: { definition: number }[] = [];
    const report = await explainReport(
      { input: DEMO_CASES.safe as EngineInput, today: DEMO_TODAY, tenancies: [] },
      ask,
      { onCheck: (_c, t) => terms.push(t) },
    );
    return { report, requests, terms };
  };

  it("tells the AI not to write meanings and lists the terms that have approved wording", async () => {
    const { requests } = await run(["전입신고와 확정일자를 꼭 받으세요."]);
    expect(requests[0].system).toMatch(/용어의 뜻은 쓰지 마세요/);
    for (const term of ["대항력", "우선변제권", "확정일자", "가처분"]) expect(requests[0].system).toContain(term);
  });

  it("asks again when a meaning was written, and counts it", async () => {
    const { report, terms } = await run(["전입신고와 확정일자를 받으면 대항력과 우선변제권이 생겨요.", "전입신고와 확정일자를 꼭 받으세요."]);
    expect(report.attempts).toBe(2);
    expect(terms).toEqual([{ definition: 1 }, { definition: 0 }]);
    expect(report.topics[0].explanation.map((s) => s.text)).toEqual(["전입신고와 확정일자를 꼭 받으세요."]);
  });
});
