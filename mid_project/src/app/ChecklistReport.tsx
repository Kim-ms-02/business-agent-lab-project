"use client";

// v0.5 체크리스트 코치 화면: replaces the old one-grade result box. Statuses come from src/checklist (rule engine
// results only).
import type { ReviewOk } from "@/agent/extract";
import { EXCLUDED_ITEMS, STATUS_LABELS, type Stage } from "@/checklist/items";
import { registrySummary } from "@/checklist/registrySummary";
import { buildChecklist, summaryLines, type BuiltItem, type ChecklistContext } from "@/checklist/status";
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
  const { errors } = submitted.result;

  return (
    <section className={styles.report} aria-live="polite">
      <h2 className={styles.title}>계약 전 체크리스트</h2>

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
                <ItemCard key={item.no} item={item} />
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

function ItemCard({ item }: { item: BuiltItem }) {
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
      <p className={styles.source}>출처: {item.source}</p>
    </article>
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
