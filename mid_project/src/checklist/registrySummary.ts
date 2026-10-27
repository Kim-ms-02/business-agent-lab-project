// v0.5 등기부 쉬운 요약: the values the user confirmed on the 등기부 review screen, in plain words, each with its
// 원문 근거 and the approved glossary wording. Nothing here is graded or recalculated.
import { GLOSSARY } from "../agent/content";
import type { GlossaryEntry } from "../agent/explain";
import type { Evidence, ReviewOk } from "../agent/extract";

export type SummaryRow = { label: string; value: string; evidence: Evidence[]; terms: GlossaryEntry[] };

const NONE = "없어요";
const UNREAD = "확인하지 못했어요";

// Glossary entry for a 갑구 record; 신탁 is explained as 신탁등기.
const TITLE_TERM: Record<string, string> = { 신탁: "신탁등기" };
const TENANCY_TERM = { 전세권: "전세권", 임차권: "임차권등기" } as const;

function terms(names: string[]): GlossaryEntry[] {
  return names.flatMap((n) => GLOSSARY.filter((g) => g.term === n));
}

// 24000 (만원) -> "2억 4,000만원"
function manwonText(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const man = manwon % 10000;
  const parts = [eok > 0 && `${eok}억`, man > 0 && `${man.toLocaleString("ko-KR")}만`].filter(Boolean);
  return parts.length === 0 ? "0원" : `${parts.join(" ")}원`;
}

const wonText = (won: number) => manwonText(Math.ceil(won / 10000));

export function registrySummary(review: ReviewOk): SummaryRow[] {
  const owners = review.owners.value;
  const ownerRow: SummaryRow = {
    label: "소유자",
    value: owners === null || owners.length === 0 ? UNREAD : owners.map((o) => o.name).join(", ") + (owners.length > 1 ? " (공동명의)" : ""),
    evidence: review.owners.evidence,
    terms: [],
  };

  const total = review.mortgageTotal.value;
  const count = review.mortgages.length;
  const mortgageRow: SummaryRow = {
    label: "근저당",
    value: count === 0 && total === 0 ? NONE : total === null ? `${count}건 · 채권최고액 합계 ${UNREAD}` : `${count}건 · 채권최고액 합계 ${manwonText(total)}`,
    evidence: [...review.mortgages.flatMap((m) => m.evidence), ...review.mortgageTotal.evidence].filter(
      (e, i, all) => all.findIndex((x) => x.quote === e.quote) === i,
    ),
    terms: terms(["을구", "근저당권"]),
  };

  const issues = review.titleIssues.value;
  const titleRow: SummaryRow = {
    label: "갑구 위험 기록",
    value: issues === null ? UNREAD : issues.length === 0 ? NONE : issues.join(", "),
    evidence: review.titleIssues.evidence,
    terms: terms(["갑구", ...(issues ?? []).map((i) => TITLE_TERM[i] ?? i)]),
  };

  const tenancies = review.tenancies;
  const byKind = (["전세권", "임차권"] as const)
    .map((kind) => ({ kind, items: tenancies.filter((t) => t.kind === kind) }))
    .filter((g) => g.items.length > 0);
  const tenancyRow: SummaryRow = {
    label: "전세권·임차권등기",
    value:
      byKind.length === 0
        ? NONE
        : byKind
            .map(({ kind, items }) => {
              const amounts = items.filter((t) => t.amountWon !== null).map((t) => wonText(t.amountWon as number));
              const label = kind === "전세권" ? "전세금" : "보증금";
              return `${kind === "전세권" ? "전세권" : "임차권등기"} ${items.length}건${amounts.length > 0 ? `(${label} ${amounts.join(", ")})` : ""}`;
            })
            .join(", "),
    evidence: tenancies.flatMap((t) => t.evidence),
    terms: tenancies.length === 0 ? [] : terms(["을구", ...byKind.map((g) => TENANCY_TERM[g.kind])]),
  };

  return [ownerRow, mortgageRow, titleRow, tenancyRow];
}
