// Easy explanations and questions with sources (v0.5).
// The AI only gets the risk result (as plain facts made here) and the document chunks found for it.
// Code checks every sentence: it must cite a given chunk, and every number in it must be in the result
// or in a chunk it cites. Bad sentences are sent back up to EXPLAIN_MAX_RETRIES times, then dropped.
import type { EngineResult, Grade, Hit } from "../rules/engine";
import type { Chunk } from "./retrieve";

export type TopicId =
  | "jeonseRatio"
  | "seniorBurden"
  | "titleIssues"
  | "recentTransfer"
  | "landlord"
  | "address"
  | "guarantee"
  | "tenancy:전세권"
  | "tenancy:임차권"
  | "basics";

export type Topic = {
  id: TopicId;
  title: string;
  grade: Grade | "경고" | "확인" | "기본";
  facts: string[]; // what the AI may say about the result; never names or the actual 동·호수
};

export type TopicContext = { topic: Topic; chunks: Chunk[] };
export type Sentence = { text: string; sources: string[] }; // sources = chunk ids
export type AiOutput = { topics: { topicId: string; explanation: Sentence[]; questions: Sentence[] }[] };

const TITLES: Record<TopicId, string> = {
  jeonseRatio: "전세가율",
  seniorBurden: "선순위 부담률",
  titleIssues: "갑구 위험 기재",
  recentTransfer: "최근 소유권 이전",
  landlord: "집주인 확인",
  address: "주소 확인",
  guarantee: "보증보험 가입 가능성",
  "tenancy:전세권": "등기부의 전세권",
  "tenancy:임차권": "등기부의 임차권등기",
  basics: "계약 전 기본 확인",
};

// ---------- money / percent wording shared by facts and checks ----------

// 45000 (만원) -> "4억 5,000만 원"
export function manwonText(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const rest = manwon % 10000;
  if (eok === 0) return `${rest.toLocaleString("ko-KR")}만 원`;
  return rest === 0 ? `${eok}억 원` : `${eok}억 ${rest.toLocaleString("ko-KR")}만 원`;
}

const money = (manwon: number) => `${manwonText(manwon)}(${manwon.toLocaleString("ko-KR")}만원)`;
const pct = (ratio: number) => `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
const pctWhole = (ratio: number) => `${Math.round(ratio * 100)}%`;
const num = (v: unknown) => (typeof v === "number" ? v : 0);

// ---------- topics ----------

export type TenancyFact = { kind: "전세권" | "임차권"; amountWon: number | null };

// One topic per hit (engine order), then the 보증보험 warning, then 전세권·임차권 from the 등기부.
// With nothing to explain, a single "basics" topic carries the 기본 확인 사항.
export function buildTopics(result: EngineResult, tenancies: TenancyFact[]): Topic[] {
  const topics: Topic[] = result.hits.map((h) => ({
    id: h.ruleId,
    title: TITLES[h.ruleId],
    grade: h.grade,
    facts: hitFacts(h, result),
  }));
  if (result.guarantee.result === "가입 가능성 낮음") {
    topics.push({
      id: "guarantee",
      title: TITLES.guarantee,
      grade: "경고",
      facts: [
        "결과: 보증보험 가입 가능성 낮음",
        ...result.guarantee.reasons,
        ...(result.guarantee.housePrice !== null ? [`계산에 쓴 주택가격 ${money(result.guarantee.housePrice)}`] : []),
      ],
    });
  }
  for (const kind of ["전세권", "임차권"] as const) {
    const items = tenancies.filter((t) => t.kind === kind);
    if (items.length === 0) continue;
    const id = `tenancy:${kind}` as const;
    topics.push({
      id,
      title: TITLES[id],
      grade: "확인",
      facts: [
        `등기부 을구에 말소되지 않은 ${kind === "임차권" ? "임차권등기" : "전세권"} ${items.length}건`,
        ...items.flatMap((t) =>
          t.amountWon === null ? [] : [`${kind === "임차권" ? "임차보증금" : "전세금"} ${money(Math.ceil(t.amountWon / 10000))}`],
        ),
      ],
    });
  }
  if (topics.length === 0) topics.push({ id: "basics", title: TITLES.basics, grade: "기본", facts: ["걸린 위험 규칙 없음"] });
  return topics;
}

function hitFacts(h: Hit, result: EngineResult): string[] {
  const v = h.values;
  switch (h.ruleId) {
    case "jeonseRatio":
      return [
        `보증금 ${money(num(v.deposit))}`,
        `매매시세 ${money(num(v.marketPrice))}`,
        `전세가율(보증금 ÷ 매매시세) ${pct(num(v.ratio))}`,
        `기준: ${pctWhole(num(v.threshold))} 이상이면 ${h.grade}`,
      ];
    case "seniorBurden":
      return [
        `근저당 채권최고액 합계 ${money(num(v.mortgageMaxTotal))}`,
        `보증금 ${money(num(v.deposit))}`,
        `매매시세 ${money(num(v.marketPrice))}`,
        `선순위 부담률((근저당 + 보증금) ÷ 매매시세) ${pct(num(v.ratio))}`,
        `기준: ${pctWhole(num(v.threshold))}를 넘으면 위험`,
      ];
    case "titleIssues":
      return [`갑구 기재: ${(Array.isArray(v.items) ? v.items : []).join(", ")}`];
    case "recentTransfer":
      return [
        `소유권 이전일(접수일) ${String(v.ownershipTransferDate)}`,
        `기준: 최근 ${num(v.withinMonths)}개월 안에 소유권이 바뀌면 주의`,
      ];
    case "landlord":
      // The engine's reason names the people, so the facts are rebuilt without names.
      return result.landlord.result === "불일치"
        ? ["결과: 위험: 집주인 불일치", "계약서의 임대인과 등기부의 소유자가 다른 사람"]
        : [
            "결과: 확인 필요",
            ...result.landlord.reasons.flatMap((r) =>
              r.includes("공동명의") ? ["공동명의인데 임대인이 소유자 중 일부"]
              : r.includes("대리인") ? ["대리인이 계약"]
              : r.includes("법인") ? ["법인(회사) 소유"]
              : [],
            ),
          ];
    case "address":
      return [
        "결과: 확인 필요: 주소 불일치",
        `다른 부분: ${result.address.reasons.map((r) => /^(지번|동|호수)/.exec(r)?.[1]).filter(Boolean).join(", ")}`,
      ];
  }
}

// ---------- numbers ----------

export type NumberMention =
  | { kind: "pct"; value: number; raw: string }
  | { kind: "money"; value: number; raw: string } // 만원
  | { kind: "date"; value: string; raw: string } // YYYY-MM-DD
  | { kind: "year"; value: number; raw: string }
  | { kind: "months"; value: number; raw: string }
  | { kind: "article"; value: string; raw: string } // "3의2"
  | { kind: "num"; value: number; raw: string };

const n = (s: string) => Number(s.replace(/,/g, ""));
const pad = (s: string) => s.padStart(2, "0");

// Patterns in priority order; a matched span is blanked so later patterns cannot read it again.
const PATTERNS: [RegExp, (m: RegExpExecArray) => Omit<NumberMention, "raw">][] = [
  [/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/g, (m) => ({ kind: "date", value: `${m[1]}-${pad(m[2])}-${pad(m[3])}` })],
  [/(\d{4})-(\d{2})-(\d{2})/g, (m) => ({ kind: "date", value: `${m[1]}-${m[2]}-${m[3]}` })],
  [
    /(\d[\d,]*(?:\.\d+)?)\s*억(?:\s*(\d[\d,]*)\s*(천)?\s*만)?(?:\s*원)?/g,
    (m) => ({ kind: "money", value: Math.round(n(m[1]) * 10000 + (m[2] ? n(m[2]) * (m[3] ? 1000 : 1) : 0)) }),
  ],
  [/(\d[\d,]*)\s*(천)?\s*만\s*원?/g, (m) => ({ kind: "money", value: n(m[1]) * (m[2] ? 1000 : 1) })],
  [/(\d[\d,]*)\s*원/g, (m) => ({ kind: "money", value: n(m[1]) / 10000 })],
  [/(\d+(?:\.\d+)?)\s*%/g, (m) => ({ kind: "pct", value: n(m[1]) })],
  [/(\d+)\s*개월/g, (m) => ({ kind: "months", value: n(m[1]) })],
  [/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g, (m) => ({ kind: "article", value: m[2] ? `${m[1]}의${m[2]}` : m[1] })],
  [/(\d{4})\s*년/g, (m) => ({ kind: "year", value: n(m[1]) })],
  [/\d[\d,]*(?:\.\d+)?/g, (m) => ({ kind: "num", value: n(m[0]) })],
];

export function extractNumbers(text: string): NumberMention[] {
  let work = text;
  const found: (NumberMention & { at: number })[] = [];
  for (const [re, read] of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    const blanks: [number, number][] = [];
    while ((m = re.exec(work)) !== null) {
      found.push({ ...read(m), raw: m[0].trim(), at: m.index } as NumberMention & { at: number });
      blanks.push([m.index, m[0].length]);
    }
    for (const [at, len] of blanks) work = work.slice(0, at) + " ".repeat(len) + work.slice(at + len);
  }
  return found
    .sort((a, b) => a.at - b.at)
    .map((m) => {
      const out: Partial<typeof m> = { ...m };
      delete out.at;
      return out as NumberMention;
    });
}

function sameNumber(said: NumberMention, known: NumberMention): boolean {
  switch (said.kind) {
    case "pct":
      // "89%" may stand for 88.9%, but not for anything else
      return known.kind === "pct" && (Math.abs(said.value - known.value) < 1e-9 || (Number.isInteger(said.value) && said.value === Math.round(known.value)));
    case "year":
      return (known.kind === "year" && known.value === said.value) || (known.kind === "date" && known.value.startsWith(`${said.value}-`));
    case "num":
      return typeof known.value === "number" && known.value === said.value;
    default:
      return known.kind === said.kind && known.value === said.value;
  }
}

// ---------- checks ----------

export type Problem = { topicId: string; part: "explanation" | "questions"; index: number; text: string; reasons: string[] };

export function checkOutput(output: AiOutput, contexts: TopicContext[]): Problem[] {
  const problems: Problem[] = [];
  for (const t of output.topics) {
    const ctx = contexts.find((c) => c.topic.id === t.topicId);
    if (!ctx) continue; // a topic we did not ask about is dropped by finalizeReport
    const factNumbers = extractNumbers(ctx.topic.facts.join("\n"));
    for (const part of ["explanation", "questions"] as const) {
      t[part].forEach((s, index) => {
        const reasons = sentenceProblems(s, ctx, factNumbers);
        if (reasons.length > 0) problems.push({ topicId: t.topicId, part, index, text: s.text, reasons });
      });
    }
  }
  return problems;
}

function sentenceProblems(s: Sentence, ctx: TopicContext, factNumbers: NumberMention[]): string[] {
  const reasons: string[] = [];
  if (s.sources.length === 0) reasons.push("출처가 없어요");
  const unknown = s.sources.filter((id) => !ctx.chunks.some((c) => c.id === id));
  if (unknown.length > 0) reasons.push(`받지 않은 출처: ${unknown.join(", ")}`);
  const cited = ctx.chunks.filter((c) => s.sources.includes(c.id));
  const allowed = [...factNumbers, ...cited.flatMap((c) => extractNumbers(c.text))];
  const strangers = extractNumbers(s.text).filter((said) => !allowed.some((known) => sameNumber(said, known)));
  if (strangers.length > 0) reasons.push(`판정 결과나 인용한 문서에 없는 숫자: ${strangers.map((x) => x.raw).join(", ")}`);
  return reasons;
}

function withoutProblems(output: AiOutput, problems: Problem[]): AiOutput {
  const bad = (topicId: string, part: Problem["part"], index: number) =>
    problems.some((p) => p.topicId === topicId && p.part === part && p.index === index);
  return {
    topics: output.topics.map((t) => ({
      topicId: t.topicId,
      explanation: t.explanation.filter((_s, i) => !bad(t.topicId, "explanation", i)),
      questions: t.questions.filter((_s, i) => !bad(t.topicId, "questions", i)),
    })),
  };
}

// Asks, checks, and asks again with the problems as feedback, at most maxRetries more times.
// Whatever is still wrong after that is dropped (and reported in `dropped`).
export async function generateChecked(
  generate: (feedback: string[]) => Promise<AiOutput>,
  contexts: TopicContext[],
  maxRetries: number,
): Promise<{ output: AiOutput; attempts: number; dropped: Problem[] }> {
  let feedback: string[] = [];
  for (let attempt = 1; ; attempt++) {
    const output = await generate(feedback);
    const problems = checkOutput(output, contexts);
    if (problems.length === 0) return { output, attempts: attempt, dropped: [] };
    if (attempt > maxRetries) return { output: withoutProblems(output, problems), attempts: attempt, dropped: problems };
    feedback = problems.map((p) => `[${p.topicId} ${p.part} ${p.index + 1}] "${p.text}" — ${p.reasons.join(", ")}`);
  }
}

// ---------- report ----------

export type ReportSentence = Sentence & { fallback?: boolean };
export type ReportTopic = {
  topic: Topic;
  status: "ok" | "no-docs" | "no-explanation";
  message?: string;
  explanation: Sentence[];
  questions: (Sentence & { fallback: boolean })[];
  chunks: Chunk[];
};

export const NO_DOCS_MESSAGE = "관련 공식 안내를 찾지 못했어요";
export const NO_EXPLANATION_MESSAGE = "설명을 만들지 못했어요";

// An approved default question with the chunk it rests on. A plain string is cited from the topic's best chunk.
export type DefaultQuestion = string | { text: string; source: string };

// Puts the checked output next to each topic. Topics with no documents get nothing made up;
// a topic left without a question gets its approved default questions. One whose own chunk was not
// found for the topic is hidden, so a question is never shown with a source that does not back it.
export function finalizeReport(
  contexts: TopicContext[],
  output: AiOutput,
  defaultQuestions: Partial<Record<string, DefaultQuestion[]>>,
): ReportTopic[] {
  return contexts.map(({ topic, chunks }) => {
    if (chunks.length === 0) {
      return { topic, status: "no-docs", message: NO_DOCS_MESSAGE, explanation: [], questions: [], chunks };
    }
    const t = output.topics.find((x) => x.topicId === topic.id);
    const explanation = t?.explanation ?? [];
    let questions = (t?.questions ?? []).map((q) => ({ ...q, fallback: false }));
    if (questions.length === 0) {
      questions = (defaultQuestions[topic.id] ?? []).flatMap((q) =>
        typeof q === "string" ? [{ text: q, sources: [chunks[0].id], fallback: true }]
        : chunks.some((c) => c.id === q.source) ? [{ text: q.text, sources: [q.source], fallback: true }]
        : [],
      );
    }
    return explanation.length > 0
      ? { topic, status: "ok", explanation, questions, chunks }
      : { topic, status: "no-explanation", message: NO_EXPLANATION_MESSAGE, explanation, questions, chunks };
  });
}

export type GlossaryEntry = { term: string; plain: string; source: string };

// A plain-word explanation of a term is shown only when its source chunk is really there.
export function visibleGlossary(glossary: GlossaryEntry[], chunks: Chunk[]): GlossaryEntry[] {
  return glossary.filter((g) => chunks.some((c) => c.id === g.source));
}
