"use client";

// v0.5 체크리스트 코치 화면: replaces the old one-grade result box. Statuses come from src/checklist (rule engine
// results only); the AI explanation is an optional extra under each item and never changes a status.
import { useState } from "react";
import type { ReportTopic, TenancyFact } from "@/agent/explain";
import type { ReviewOk } from "@/agent/extract";
import { EXCLUDED_ITEMS, STATUS_LABELS, type Stage } from "@/checklist/items";
import { registrySummary } from "@/checklist/registrySummary";
import { buildChecklist, summaryLines, topicItemNo, type BuiltItem, type ChecklistContext } from "@/checklist/status";
import type { EngineInput, EngineResult, Field } from "@/rules/engine";
import styles from "./Checklist.module.css";

export type Submitted = { input: EngineInput; today: string; result: EngineResult };

const STAGES: Stage[] = ["계약 전", "계약할 때", "계약 후"];
const ICONS = { ok: "✅", hit: "⚠", input: "✏️", manual: "❓" } as const;

const FIELD_LABELS: Record<Field, string> = {
  deposit: "보증금",
  marketPrice: "매매시세",
  mortgageMaxTotal: "근저당 채권최고액 합계",
  titleIssues: "갑구 위험 기재",
  ownershipTransferDate: "소유권 이전일",
};

type ExplainState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; topics: ReportTopic[] }
  | { kind: "error"; message: string };

export default function ChecklistReport({
  submitted,
  registry,
  context,
}: {
  submitted: Submitted;
  registry: ReviewOk | null;
  context: ChecklistContext;
}) {
  const { items, summary } = buildChecklist(submitted.result, context);
  // The parent remounts this on every new check, so an old explanation never sticks to a new result.
  const [explain, setExplain] = useState<ExplainState>({ kind: "idle" });

  async function makeExplanation() {
    setExplain({ kind: "loading" });
    const tenancies: TenancyFact[] = (registry?.tenancies ?? []).map((t) => ({ kind: t.kind, amountWon: t.amountWon }));
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: submitted.input, today: submitted.today, tenancies }),
      });
      const body = await res.json();
      if (!res.ok) setExplain({ kind: "error", message: body.error ?? "설명을 만들지 못했어요. 위의 체크리스트는 그대로 볼 수 있어요." });
      else setExplain({ kind: "done", topics: body.topics as ReportTopic[] });
    } catch {
      setExplain({ kind: "error", message: "연결이 끊겨 설명을 만들지 못했어요. 위의 체크리스트는 그대로 볼 수 있어요." });
    }
  }

  const topicsFor = (no: number | null) =>
    explain.kind === "done" ? explain.topics.filter((t) => topicItemNo(t.topic.id) === no) : [];
  const { errors } = submitted.result;

  return (
    <section className={styles.report} aria-live="polite">
      <div className={styles.topBar}>
        <h2 className={styles.title}>계약 전 체크리스트</h2>
        <LargeTextButton />
      </div>

      <div className={styles.summary}>
        {summaryLines(summary).map((line) => (
          <p key={line} className={styles.summaryLine}>{line}</p>
        ))}
        <p className={styles.note}>✅는 앱이 확인한 범위에서 걸린 것이 없다는 뜻이에요. 안전을 약속하지는 않아요.</p>
        {errors.length > 0 && (
          <ul className={styles.errors}>
            {errors.map((e) => (
              <li key={e.field}>고쳐야 할 값 · {FIELD_LABELS[e.field]}: {e.message}</li>
            ))}
          </ul>
        )}
      </div>

      <RegistrySummary registry={registry} />

      <div className={styles.explainBar}>
        <button type="button" className={styles.explainButton} onClick={makeExplanation} disabled={explain.kind === "loading"}>
          {explain.kind === "loading" ? "공식 안내를 찾아 설명을 쓰는 중이에요…" : "쉬운 설명 만들기"}
        </button>
        <p className={styles.note}>
          누르면 AI가 공식 문서에서 찾은 내용으로 항목 아래에 쉬운 설명을 붙여요. 1분쯤 걸릴 수 있어요. 항목의 상태는 바뀌지 않아요.
        </p>
        {explain.kind === "error" && <p className={styles.errorText} role="alert">{explain.message}</p>}
        {topicsFor(null).map((t) => <Explanation key={t.topic.id} topic={t} />)}
      </div>

      {STAGES.map((stage) => {
        const inStage = items.filter((i) => i.stage === stage);
        return (
          <details key={stage} className={styles.stage} open>
            <summary className={styles.stageTitle}>
              <span>{stage}</span>
              <span className={styles.stageCounts}>{stageCounts(inStage)}</span>
            </summary>
            <div className={styles.cards}>
              {inStage.map((item) => (
                <ItemCard key={item.no} item={item} topics={topicsFor(item.no)} />
              ))}
            </div>
          </details>
        );
      })}

      <div className={styles.footer}>
        <p className={styles.disclaimer}>
          이 체크리스트는 법률 자문이 아니라 확인을 돕는 도구예요. 중요한 결정은 공인중개사·법무사 등 전문가와 상의하세요.
        </p>
        <p className={styles.note}>
          알려진 한계: 안내서의 심화 사항 중 다음은 이번에 넣지 않았어요 —{" "}
          {EXCLUDED_ITEMS.map((e) => `${e.title}(본문 ${e.pages})`).join(", ")}.
        </p>
      </div>
    </section>
  );
}

function stageCounts(items: BuiltItem[]): string {
  return (["ok", "hit", "input", "manual"] as const)
    .map((k) => [k, items.filter((i) => i.status.kind === k).length] as const)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${ICONS[k]} ${n}`)
    .join(" · ");
}

function statusText(item: BuiltItem): string {
  const s = item.status;
  return s.kind === "hit" && s.label ? `${STATUS_LABELS.hit} · ${s.label}` : STATUS_LABELS[s.kind];
}

function statusClass(item: BuiltItem): string {
  const s = item.status;
  if (s.kind === "hit") return s.label === "위험" ? styles.danger : styles.caution;
  return { ok: styles.ok, input: styles.input, manual: styles.manual }[s.kind];
}

function ItemCard({ item, topics }: { item: BuiltItem; topics: ReportTopic[] }) {
  const s = item.status;
  return (
    <article className={`${styles.card} ${statusClass(item)}`}>
      <header className={styles.cardHead}>
        <h3 className={styles.cardTitle}>
          {item.no}. {item.title}
        </h3>
        <span className={styles.badge}>{statusText(item)}</span>
      </header>
      {/* ⚠ already names 위험·주의 in the badge; the default ❓ needs no extra line. */}
      {s.kind !== "hit" && s.message !== "직접 확인하세요" && <p className={styles.message}>{s.message}</p>}
      {s.reasons.length > 0 && (
        <ul className={styles.reasons}>
          {s.reasons.map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <p>
        <span className={styles.label}>확인 방법 </span>
        {item.guide}
      </p>
      {item.questions.length > 0 && (
        <div>
          <p className={styles.label}>물어볼 질문</p>
          <ul className={styles.questions}>
            {item.questions.map((q) => (
              <li key={q.text}>{q.to ? `(${q.to}에게) ` : ""}{q.text}</li>
            ))}
          </ul>
        </div>
      )}
      {item.terms.length > 0 && (
        <dl className={styles.terms}>
          {item.terms.map((t) => (
            <div key={t.term}>
              <dt>{t.term}</dt>
              <dd>{t.plain}</dd>
            </div>
          ))}
        </dl>
      )}
      {topics.map((t) => <Explanation key={t.topic.id} topic={t} />)}
      <p className={styles.source}>출처: {item.source}</p>
    </article>
  );
}

function Explanation({ topic }: { topic: ReportTopic }) {
  const where = (id: string) => {
    const c = topic.chunks.find((x) => x.id === id);
    return c ? `${c.title} ${c.locator}` : id;
  };
  return (
    <div className={styles.explanation}>
      <p className={styles.label}>쉬운 설명 (AI · {topic.topic.title})</p>
      {topic.message && <p className={styles.note}>{topic.message}</p>}
      <ul>
        {topic.explanation.map((s) => (
          <li key={s.text}>
            {s.text} <span className={styles.source}>({s.sources.map(where).join(", ")})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RegistrySummary({ registry }: { registry: ReviewOk | null }) {
  return (
    <div className={styles.registry}>
      <h3 className={styles.sectionTitle}>등기부 쉬운 요약</h3>
      {registry === null ? (
        <p className={styles.note}>등기부등본을 올리고 값을 확인하면 여기에 쉬운 말로 요약해 드려요.</p>
      ) : (
        <>
          <p className={styles.note}>등기부 확인 화면에서 확인한 값이에요.</p>
          <dl className={styles.registryRows}>
            {registrySummary(registry).map((row) => (
              <div key={row.label} className={styles.registryRow}>
                <dt className={styles.label}>{row.label}</dt>
                <dd>
                  <p className={styles.registryValue}>{row.value}</p>
                  {row.evidence.map((e, i) => (
                    <p key={i} className={styles.source}>
                      근거{e.location && ` (${e.location})`}: <q>{e.quote}</q>
                    </p>
                  ))}
                  {row.terms.map((t) => (
                    <p key={t.term} className={styles.termLine}>
                      <strong>{t.term}</strong>: {t.plain}
                    </p>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}

function LargeTextButton() {
  // Rendered only after a check on the client, so document is there.
  const [large, setLarge] = useState(() => document.documentElement.classList.contains("large-text"));
  function toggle() {
    const next = !large;
    document.documentElement.classList.toggle("large-text", next);
    setLarge(next);
  }
  return (
    <button type="button" className={styles.largeText} aria-pressed={large} onClick={toggle}>
      {large ? "보통 글씨로 보기" : "큰 글씨 보기"}
    </button>
  );
}
