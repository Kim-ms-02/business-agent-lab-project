// Risk rule engine. Pure functions only: the grade and every number come from here, never from the LLM.
// All money amounts are in 만원 (10,000 KRW).

import { JEONSE_RATIO, RECENT_TRANSFER, SENIOR_BURDEN, type Source } from "./config";

export type Grade = "안전" | "주의" | "위험";

// 갑구 entries that make a property immediately 위험 (rule 3).
export const TITLE_ISSUES = ["가압류", "압류", "가처분", "경매개시결정", "신탁", "가등기"] as const;
export type TitleIssue = (typeof TITLE_ISSUES)[number];

export type EngineInput = {
  deposit?: number;
  marketPrice?: number;
  mortgageMaxTotal?: number; // sum of 근저당 채권최고액; 0 when there is none
  titleIssues?: TitleIssue[];
  noTitleIssues?: boolean; // user explicitly confirmed "해당 없음"
  ownershipTransferDate?: string; // YYYY-MM-DD
};

export type Field =
  | "deposit"
  | "marketPrice"
  | "mortgageMaxTotal"
  | "titleIssues"
  | "ownershipTransferDate";

export type RuleId = "jeonseRatio" | "seniorBurden" | "titleIssues" | "recentTransfer";

export type Hit = {
  ruleId: RuleId;
  grade: Grade;
  reason: string;
  values: Record<string, number | string | string[]>;
  source: Source;
};

export type EngineResult = {
  grade: Grade | null; // null: a value is missing or invalid and no 위험 rule fired
  hits: Hit[];
  missing: Field[];
  errors: { field: Field; message: string }[];
  metrics: { jeonseRatio?: number; seniorBurdenRatio?: number };
};

const GRADE_ORDER: Grade[] = ["안전", "주의", "위험"];

export function evaluate(input: EngineInput, today: string): EngineResult {
  const missing: Field[] = [];
  const errors: EngineResult["errors"] = [];
  const hits: Hit[] = [];
  const metrics: EngineResult["metrics"] = {};

  const deposit = readAmount(input.deposit, "deposit", { allowZero: false }, missing, errors);
  const marketPrice = readAmount(input.marketPrice, "marketPrice", { allowZero: false }, missing, errors);
  const mortgage = readAmount(input.mortgageMaxTotal, "mortgageMaxTotal", { allowZero: true }, missing, errors);
  const titleIssues = readTitleIssues(input, missing, errors);
  const transferDate = readTransferDate(input.ownershipTransferDate, today, missing, errors);

  // Rule 1: 전세가율
  if (deposit !== undefined && marketPrice !== undefined) {
    const ratio = deposit / marketPrice;
    metrics.jeonseRatio = ratio;
    const grade: Grade | null =
      ratio >= JEONSE_RATIO.dangerAtOrAbove ? "위험" : ratio >= JEONSE_RATIO.cautionAtOrAbove ? "주의" : null;
    if (grade) {
      const line = grade === "위험" ? JEONSE_RATIO.dangerAtOrAbove : JEONSE_RATIO.cautionAtOrAbove;
      hits.push({
        ruleId: "jeonseRatio",
        grade,
        reason: `보증금이 매매시세의 ${pct(ratio)}입니다. ${pct(line)} 이상이면 ${grade === "위험" ? "위험으로" : "주의로"} 봅니다. 집값이 떨어지면 보증금을 돌려받기 어려울 수 있습니다.`,
        values: { deposit, marketPrice, ratio, threshold: line },
        source: JEONSE_RATIO.source,
      });
    }
  }

  // Rule 2: 선순위 부담률
  if (deposit !== undefined && marketPrice !== undefined && mortgage !== undefined) {
    const ratio = (mortgage + deposit) / marketPrice;
    metrics.seniorBurdenRatio = ratio;
    if (ratio > SENIOR_BURDEN.dangerAbove) {
      hits.push({
        ruleId: "seniorBurden",
        grade: "위험",
        reason: `근저당 채권최고액(${won(mortgage)})과 보증금(${won(deposit)})을 더하면 매매시세의 ${pct(ratio)}입니다. ${pct(SENIOR_BURDEN.dangerAbove)}를 넘으면 집이 경매로 팔려도 보증금을 다 돌려받지 못할 수 있습니다.`,
        values: { mortgageMaxTotal: mortgage, deposit, marketPrice, ratio, threshold: SENIOR_BURDEN.dangerAbove },
        source: SENIOR_BURDEN.source,
      });
    }
  }

  // Rule 3: 갑구 위험 기재
  if (titleIssues && titleIssues.length > 0) {
    hits.push({
      ruleId: "titleIssues",
      grade: "위험",
      reason: `등기부 갑구에 ${titleIssues.join(", ")} 기록이 있습니다. 집주인이 집을 마음대로 처분할 수 없거나 집이 팔릴 수 있는 상태라는 뜻이라 바로 위험으로 봅니다.`,
      values: { items: [...titleIssues] },
      source: { source: "자체 기준(CLAUDE.md 규칙 3, HUG 갑구 확인 항목 참고)", url: "URL 미확인", basisDate: "2026-10-08" },
    });
  }

  // Rule 5: 최근 소유권 이전
  if (transferDate !== undefined) {
    const cutoff = subtractMonths(today, RECENT_TRANSFER.withinMonths);
    if (transferDate >= cutoff) {
      hits.push({
        ruleId: "recentTransfer",
        grade: "주의",
        reason: `집주인이 바뀐 지 ${RECENT_TRANSFER.withinMonths}개월이 안 됐습니다(${transferDate}). 최근에 집주인이 바뀐 집은 사정을 한 번 더 확인하는 것이 좋습니다.`,
        values: { ownershipTransferDate: transferDate, cutoff, withinMonths: RECENT_TRANSFER.withinMonths },
        source: RECENT_TRANSFER.source,
      });
    }
  }

  const worst = hits.reduce<Grade>(
    (acc, h) => (GRADE_ORDER.indexOf(h.grade) > GRADE_ORDER.indexOf(acc) ? h.grade : acc),
    "안전",
  );
  const incomplete = missing.length > 0 || errors.length > 0;
  // Never report 안전 (or a possibly understated 주의) while a value is missing or invalid.
  const grade = worst === "위험" ? "위험" : incomplete ? null : worst;

  return { grade, hits, missing, errors, metrics };
}

function readAmount(
  value: number | undefined,
  field: Field,
  opts: { allowZero: boolean },
  missing: Field[],
  errors: EngineResult["errors"],
): number | undefined {
  if (value === undefined || Number.isNaN(value)) {
    missing.push(field);
    return undefined;
  }
  if (!Number.isInteger(value)) {
    errors.push({ field, message: "만원 단위 정수로 입력해 주세요." });
    return undefined;
  }
  if (value < 0 || (!opts.allowZero && value === 0)) {
    errors.push({ field, message: opts.allowZero ? "0 이상이어야 합니다." : "0보다 커야 합니다." });
    return undefined;
  }
  return value;
}

function readTitleIssues(
  input: EngineInput,
  missing: Field[],
  errors: EngineResult["errors"],
): TitleIssue[] | undefined {
  const items = input.titleIssues ?? [];
  if (input.noTitleIssues && items.length > 0) {
    errors.push({ field: "titleIssues", message: "'해당 없음'과 다른 항목을 함께 고를 수 없습니다." });
    return undefined;
  }
  if (!input.noTitleIssues && items.length === 0) {
    missing.push("titleIssues");
    return undefined;
  }
  return items;
}

function readTransferDate(
  value: string | undefined,
  today: string,
  missing: Field[],
  errors: EngineResult["errors"],
): string | undefined {
  if (value === undefined) {
    missing.push("ownershipTransferDate");
    return undefined;
  }
  if (!isValidDate(value)) {
    errors.push({ field: "ownershipTransferDate", message: "날짜 형식(YYYY-MM-DD)이 올바르지 않습니다." });
    return undefined;
  }
  if (value > today) {
    errors.push({ field: "ownershipTransferDate", message: "오늘 이후 날짜는 입력할 수 없습니다." });
    return undefined;
  }
  return value;
}

function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Calendar-month subtraction on YYYY-MM-DD strings; clamps to the last day of shorter months.
function subtractMonths(date: string, months: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const total = y * 12 + (mo - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const td = Math.min(d, daysInMonth(ty, tm));
  return `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}

function pct(ratio: number): string {
  return `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
}

function won(manwon: number): string {
  return `${manwon.toLocaleString("ko-KR")}만원`;
}
