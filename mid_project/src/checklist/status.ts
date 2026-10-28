// v0.5 체크리스트 코치: the status of each of the 17 items. Items 1, 2, 5, 8 and 9 read the rule engine's result
// only; this file never decides a grade or makes a number. Every other item is ❓ 직접 확인.
import { DEFAULT_QUESTIONS } from "../agent/content";
import type { TopicId } from "../agent/explain";
import { JEONSE_RATIO } from "../rules/config";
import type { EngineResult, Field, Grade, Hit, RuleId } from "../rules/engine";
import { CHECKLIST_ITEMS, type ChecklistItem, type ChecklistQuestion, type StatusKind } from "./items";

export type HitLabel = Grade | "확인 필요" | "가입 가능성 낮음";

export type ItemStatus = {
  kind: StatusKind;
  label: HitLabel | null; // set only for ⚠ 걸림
  message: string;
  reasons: string[];
  needs: string[]; // for ✏️: what to enter, in plain words
};

export type BuiltItem = ChecklistItem & { status: ItemStatus };

// contract: null when no 계약서 was uploaded and checked; agent = the 대리인 칸 has a name.
// tenancies: 을구 전세권·임차권등기 from the 등기부 review (not part of the grade).
export type ChecklistContext = {
  contract: { agent: boolean } | null;
  tenancies?: { kind: "전세권" | "임차권" }[];
};

export type Checklist = {
  items: BuiltItem[];
  summary: {
    counts: Record<StatusKind, number>;
    hitLabels: Partial<Record<HitLabel, number>>;
    message: string | null; // only when nothing is ⚠; other wording is decided on the screen step
  };
};

const FIELD_NAMES: Record<Field, string> = {
  deposit: "보증금",
  marketPrice: "매매시세",
  mortgageMaxTotal: "근저당 채권최고액 합계",
  titleIssues: "등기부 갑구 기록",
  ownershipTransferDate: "소유권 이전일",
};

const NO_CONTRACT = "계약서를 올리면 확인할 수 있어요";
const TRUST_NOTE = "신탁등기는 전문가와 함께 확인하세요.";
const TENANCY_LINE = "을구에 전세권·임차권등기가 있어요. 직접 확인하세요";
// The engine adds this to the 확인 필요 reasons of rule 4; on the checklist it belongs to item 9 only.
const isAgentReason = (r: string) => r.startsWith("대리인이 계약해요");

const status = (kind: StatusKind, message: string, extra: Partial<ItemStatus> = {}): ItemStatus => ({
  kind,
  label: null,
  message,
  reasons: [],
  needs: [],
  ...extra,
});

const manual = (message = "직접 확인하세요") => status("manual", message);

const input = (needs: string[]) => status("input", `입력하면 확인할 수 있어요: ${needs.join(", ")}`, { needs });

function hitStatus(label: HitLabel, reasons: string[]): ItemStatus {
  return status("hit", label, { label, reasons });
}

function worst(hits: Hit[]): Grade {
  return hits.some((h) => h.grade === "위험") ? "위험" : hits.some((h) => h.grade === "주의") ? "주의" : "안전";
}

// Fields among `fields` that are missing or invalid, in plain words.
function neededFields(result: EngineResult, fields: Field[]): string[] {
  const bad = new Set<Field>([...result.missing, ...result.errors.map((e) => e.field)]);
  return fields.filter((f) => bad.has(f)).map((f) => FIELD_NAMES[f]);
}

const hitsOf = (result: EngineResult, ids: RuleId[]) => result.hits.filter((h) => ids.includes(h.ruleId));

function marketPriceItem(result: EngineResult): ItemStatus {
  const hits = hitsOf(result, ["jeonseRatio"]);
  if (hits.length > 0) return hitStatus(worst(hits), hits.map((h) => h.reason));
  const ratio = result.metrics.jeonseRatio;
  if (ratio !== undefined) {
    const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
    return status("ok", `보증금이 집값의 ${pct(ratio)}로 주의 기준(${pct(JEONSE_RATIO.cautionAtOrAbove)}) 아래예요`);
  }
  return input(neededFields(result, ["deposit", "marketPrice"]));
}

function titleItem(result: EngineResult, ctx: ChecklistContext): { status: ItemStatus; questions: ChecklistQuestion[] } {
  const kinds = new Set((ctx.tenancies ?? []).map((t) => t.kind));
  const tenancyQuestions = [...kinds].map((k) => DEFAULT_QUESTIONS[`tenancy:${k}`][0]);
  const base = titleBase(result);
  if (kinds.size === 0) return base;
  const questions = [...base.questions, ...tenancyQuestions];
  // 전세권·임차권등기 are not graded: ✅ becomes ❓, ⚠ and ✏️ keep their status and get one more line.
  if (base.status.kind === "ok") return { status: status("manual", TENANCY_LINE), questions };
  return { status: { ...base.status, reasons: [...base.status.reasons, TENANCY_LINE] }, questions };
}

function titleBase(result: EngineResult): { status: ItemStatus; questions: ChecklistQuestion[] } {
  const hits = hitsOf(result, ["seniorBurden", "titleIssues", "recentTransfer"]);
  if (hits.length > 0) {
    const titleHit = hits.find((h) => h.ruleId === "titleIssues");
    const trust = titleHit !== undefined && (titleHit.values.items as string[]).includes("신탁");
    const questions: ChecklistQuestion[] = [
      ...(titleHit ? [DEFAULT_QUESTIONS.titleIssues[0], ...(trust ? [DEFAULT_QUESTIONS.titleIssues[2]] : [])] : []),
      ...(hits.some((h) => h.ruleId === "seniorBurden") ? [DEFAULT_QUESTIONS.seniorBurden[0]] : []),
      ...(hits.some((h) => h.ruleId === "recentTransfer") ? [DEFAULT_QUESTIONS.recentTransfer[0]] : []),
    ];
    return { status: hitStatus(worst(hits), [...hits.map((h) => h.reason), ...(trust ? [TRUST_NOTE] : [])]), questions };
  }
  const needs = neededFields(result, ["deposit", "marketPrice", "mortgageMaxTotal", "titleIssues", "ownershipTransferDate"]);
  if (needs.length > 0) return { status: input(needs), questions: [] };
  return { status: status("ok", "등기부 갑구·을구에서 걸린 기록이 없어요"), questions: [] };
}

function guaranteeItem(result: EngineResult): ItemStatus {
  const g = result.guarantee;
  switch (g.result) {
    case "가입 가능성 낮음":
      return hitStatus("가입 가능성 낮음", g.reasons);
    case "HUG에 직접 확인":
      return status("manual", "HUG에 직접 확인하세요", { reasons: g.reasons, needs: g.needs });
    case "기준 안에 있음":
      return status("ok", "기준을 넘지 않았어요 (가입을 보장하지는 않아요)", { reasons: g.notes });
    default:
      return input(g.needs);
  }
}

function landlordItem(result: EngineResult, ctx: ChecklistContext): ItemStatus {
  if (ctx.contract === null) return manual(NO_CONTRACT);
  const mismatch = result.depositMismatch;
  const depositLine = mismatch
    ? [`계약서 보증금(${mismatch.contract.toLocaleString("ko-KR")}만원)과 입력한 보증금(${mismatch.entered.toLocaleString("ko-KR")}만원)이 달라요.`]
    : [];
  // A 확인 필요 that is only about the 대리인 is shown on item 9, so it is not counted twice.
  const landlordReasons = result.landlord.reasons.filter((r) => !isAgentReason(r));
  const hits = hitsOf(result, ["landlord", "address"]).filter((h) => h.ruleId !== "landlord" || landlordReasons.length > 0);
  if (hits.length > 0) {
    const reasons = hits.map((h) =>
      h.ruleId === "landlord" && result.landlord.result === "확인 필요" ? `확인 필요: ${landlordReasons.join(" ")}` : h.reason,
    );
    return hitStatus(worst(hits), [...reasons, ...depositLine]);
  }
  if (result.landlord.result === null) return input(result.landlord.needs);
  return status("ok", "이름이 같아요. 신분증은 직접 확인하세요", { reasons: depositLine });
}

function agentItem(result: EngineResult, ctx: ChecklistContext): ItemStatus {
  if (ctx.contract === null) return manual(NO_CONTRACT);
  if (ctx.contract.agent) return hitStatus("확인 필요", result.landlord.reasons.filter(isAgentReason));
  return status("ok", "계약서 대리인 칸이 비어 있어요(집주인과 직접 계약)");
}

export function buildChecklist(result: EngineResult, ctx: ChecklistContext): Checklist {
  const title = titleItem(result, ctx);
  const byNo: Record<number, ItemStatus> = {
    1: marketPriceItem(result),
    2: title.status,
    5: guaranteeItem(result),
    8: landlordItem(result, ctx),
    9: agentItem(result, ctx),
  };
  const items: BuiltItem[] = CHECKLIST_ITEMS.map((item) => ({
    ...item,
    questions: item.no === 2 ? title.questions : item.questions,
    status: byNo[item.no] ?? manual(),
  }));

  const counts: Record<StatusKind, number> = { ok: 0, hit: 0, input: 0, manual: 0 };
  const hitLabels: Partial<Record<HitLabel, number>> = {};
  for (const { status: s } of items) {
    counts[s.kind] += 1;
    if (s.label) hitLabels[s.label] = (hitLabels[s.label] ?? 0) + 1;
  }
  const message =
    counts.hit === 0
      ? `확인한 항목에서는 위험이 보이지 않았어요 · 직접 확인할 항목 ${counts.manual}개가 남았어요`
      : null;
  return { items, summary: { counts, hitLabels, message } };
}

const LABEL_ORDER: HitLabel[] = ["위험", "주의", "확인 필요", "가입 가능성 낮음"];

// The lines at the top of the checklist. Wording other than the approved "no risk" sentence is shown to the
// user on the screen step for approval.
export function summaryLines(summary: Checklist["summary"]): string[] {
  const { counts, hitLabels, message } = summary;
  const first =
    message ??
    `⚠ 걸린 항목 ${counts.hit}개 (${LABEL_ORDER.filter((l) => hitLabels[l]).map((l) => `${l} ${hitLabels[l]}`).join(" · ")}) · 직접 확인할 항목 ${counts.manual}개가 남았어요`;
  return [first, ...(counts.input > 0 ? [`✏️ 값을 넣으면 확인할 수 있는 항목 ${counts.input}개가 있어요`] : [])];
}

// The checklist item an AI explanation topic belongs under; basics is shown above the stages.
export function topicItemNo(topicId: TopicId): number | null {
  switch (topicId) {
    case "jeonseRatio":
      return 1;
    case "seniorBurden":
    case "titleIssues":
    case "recentTransfer":
    case "tenancy:전세권":
    case "tenancy:임차권":
      return 2;
    case "guarantee":
      return 5;
    case "landlord":
    case "address":
      return 8;
    case "basics":
      return null;
  }
}
