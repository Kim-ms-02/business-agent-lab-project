// 테스트용 가상 데이터: chunks and questions below are made up.
import { describe, expect, it } from "vitest";
import { finalizeReport, type DefaultQuestion, type TopicContext } from "../src/agent/explain";
import type { Chunk } from "../src/agent/retrieve";

const chunk = (id: string, text: string): Chunk => ({
  id,
  sourceId: id.split("#")[0],
  title: "가상 안내서",
  org: "가상 기관",
  url: "https://example.go.kr",
  checkedDate: "2026-10-15",
  locator: id.split("#")[1],
  text,
});

describe("finalizeReport: 질문마다 근거 조각이 따로 있는 기본 질문", () => {
  const ctx: TopicContext = {
    topic: { id: "titleIssues", title: "갑구 위험 기재", grade: "위험", facts: ["갑구 기재: 신탁"] },
    chunks: [chunk("guide#101쪽", "가압류는 강제집행을 보전하는 절차예요."), chunk("guide#21쪽", "신탁원부를 확인해요.")],
  };

  it("cites the question's own chunk, not the topic's best chunk", () => {
    const defaults: Partial<Record<string, DefaultQuestion[]>> = {
      titleIssues: [{ text: "신탁원부를 보여 주실 수 있나요?", source: "guide#21쪽" }],
    };
    const [r] = finalizeReport([ctx], { topics: [] }, defaults);
    expect(r.questions).toEqual([{ text: "신탁원부를 보여 주실 수 있나요?", sources: ["guide#21쪽"], fallback: true }]);
  });

  it("hides a question whose chunk was not found for this topic, and keeps the rest in order", () => {
    const defaults: Partial<Record<string, DefaultQuestion[]>> = {
      titleIssues: [
        { text: "이 기재는 언제 말소되나요?", source: "guide#101쪽" },
        { text: "잔금 전에 등기부를 다시 떼어 봐도 될까요?", source: "guide#33쪽" },
        { text: "신탁원부를 보여 주실 수 있나요?", source: "guide#21쪽" },
      ],
    };
    const [r] = finalizeReport([ctx], { topics: [] }, defaults);
    expect(r.questions.map((q) => [q.text, q.sources])).toEqual([
      ["이 기재는 언제 말소되나요?", ["guide#101쪽"]],
      ["신탁원부를 보여 주실 수 있나요?", ["guide#21쪽"]],
    ]);
  });

  it("shows no question when none of their chunks were found", () => {
    const defaults: Partial<Record<string, DefaultQuestion[]>> = {
      titleIssues: [{ text: "잔금 전에 등기부를 다시 떼어 봐도 될까요?", source: "guide#33쪽" }],
    };
    const [r] = finalizeReport([ctx], { topics: [] }, defaults);
    expect(r.questions).toEqual([]);
  });

  it("does not use the default questions when the AI's questions survived", () => {
    const defaults: Partial<Record<string, DefaultQuestion[]>> = {
      titleIssues: [{ text: "신탁원부를 보여 주실 수 있나요?", source: "guide#21쪽" }],
    };
    const output = {
      topics: [
        {
          topicId: "titleIssues",
          explanation: [{ text: "신탁된 집이에요.", sources: ["guide#21쪽"] }],
          questions: [{ text: "신탁사 동의서가 있나요?", sources: ["guide#21쪽"] }],
        },
      ],
    };
    const [r] = finalizeReport([ctx], output, defaults);
    expect(r.questions).toEqual([{ text: "신탁사 동의서가 있나요?", sources: ["guide#21쪽"], fallback: false }]);
  });
});
