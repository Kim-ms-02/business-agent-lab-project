// Risk rule engine. Pure functions only: the grade and every number come from here, never from the LLM.
// All money amounts are in 만원 (10,000 KRW).

import {
  ADDRESS_CHECK,
  CAPITAL_AREA_SIDO_CODES,
  HOUSE_PRICE_METHOD,
  HUG_GUARANTEE,
  HUG_TITLE_CONDITION,
  JEONSE_RATIO,
  LANDLORD_CHECK,
  RECENT_TRANSFER,
  SENIOR_BURDEN,
  type Source,
} from "./config";

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

  // v0.4. Optional: when they are missing the new checks report what they need,
  // but the grade from rules 1–5 is not withheld.
  landlordNames?: string[]; // 계약서 임대인
  ownerNames?: string[]; // 등기부 소유자 (공유자 모두)
  isAgentContract?: boolean; // 대리인 계약
  contractUnit?: Unit; // 계약서 소재지의 지번·동·호수
  registryUnit?: Unit; // 등기부의 지번·동·호수
  contractDeposit?: number; // 계약서 보증금 (만원)
  houseType?: "apartment" | "rowhouse" | "officetel";
  lawdCd?: string; // 시군구 코드 5자리 (수도권 판단)
  publicPrice?: number; // 공시가격 (만원), typed by the user
};

export type Unit = { jibun: string; dong: string | null; ho: string };

export type Field =
  | "deposit"
  | "marketPrice"
  | "mortgageMaxTotal"
  | "titleIssues"
  | "ownershipTransferDate";

export type RuleId = "jeonseRatio" | "seniorBurden" | "titleIssues" | "recentTransfer" | "landlord" | "address";

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
  // v0.4 checks. result null = not enough values; needs lists them in plain words.
  landlord: Check<"일치" | "불일치" | "확인 필요">;
  address: Check<"일치" | "불일치">;
  depositMismatch: { contract: number; entered: number } | null;
  // Rule 6 is a warning next to the grade, never part of it.
  guarantee: Check<"가입 가능성 낮음" | "HUG에 직접 확인" | "기준 안에 있음"> & {
    housePrice: number | null; // 만원, the price used for the 90% / 60% checks
    notes: string[];
    source: Source;
  };
};

export type Check<R> = { result: R | null; reasons: string[]; needs: string[] };

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

  // Rule 4: 계약서 임대인 vs 등기부 소유자
  const landlord = checkLandlord(input);
  if (landlord.result === "불일치" || landlord.result === "확인 필요") {
    const danger = landlord.result === "불일치";
    hits.push({
      ruleId: "landlord",
      grade: danger ? "위험" : "주의",
      reason: danger
        ? `위험: 집주인 불일치 — ${landlord.reasons.join(" ")} 계약하는 사람이 등기부의 집주인이 아니면 보증금을 돌려받지 못할 수 있습니다.`
        : `확인 필요: ${landlord.reasons.join(" ")}`,
      values: { landlordNames: input.landlordNames ?? [], ownerNames: input.ownerNames ?? [] },
      source: LANDLORD_CHECK.source,
    });
  }

  // 주소 대조: 계약서 소재지 vs 등기부 (지번·동·호수)
  const address = checkAddress(input.contractUnit, input.registryUnit);
  if (address.result === "불일치") {
    hits.push({
      ruleId: "address",
      grade: "주의",
      reason: `확인 필요: 주소 불일치 — ${address.reasons.join(" ")} 계약서에 적힌 집이 등기부의 집과 같은지 확인하세요.`,
      values: {},
      source: ADDRESS_CHECK.source,
    });
  }

  const depositMismatch =
    deposit !== undefined && input.contractDeposit !== undefined && input.contractDeposit !== deposit
      ? { contract: input.contractDeposit, entered: deposit }
      : null;

  // Rule 6: 보증보험 (uses only values that passed the checks above)
  const guarantee = checkGuarantee(input, deposit, mortgage, marketPrice, titleIssues);

  const worst = hits.reduce<Grade>(
    (acc, h) => (GRADE_ORDER.indexOf(h.grade) > GRADE_ORDER.indexOf(acc) ? h.grade : acc),
    "안전",
  );
  const incomplete = missing.length > 0 || errors.length > 0;
  // Never report 안전 (or a possibly understated 주의) while a value is missing or invalid.
  const grade = worst === "위험" ? "위험" : incomplete ? null : worst;

  return { grade, hits, missing, errors, metrics, landlord, address, depositMismatch, guarantee };
}

// Spaces, parenthesized parts (한자 병기) and middle dots do not count.
export function normalizeName(name: string): string {
  return name.replace(/[(（][^)）]*[)）]/g, "").replace(/[\s·・ㆍ‧•]/g, "");
}

function checkLandlord(input: EngineInput): EngineResult["landlord"] {
  const landlords = (input.landlordNames ?? []).filter((n) => n.trim() !== "");
  const owners = (input.ownerNames ?? []).filter((n) => n.trim() !== "");
  const needs = [...(landlords.length === 0 ? ["임대인 이름"] : []), ...(owners.length === 0 ? ["등기부 소유자"] : [])];
  if (needs.length > 0) return { result: null, reasons: [], needs };

  const ownerKeys = owners.map(normalizeName);
  const strangers = landlords.filter((l) => !ownerKeys.includes(normalizeName(l)));
  if (strangers.length > 0) {
    return {
      result: "불일치",
      reasons: [`계약서 임대인(${landlords.join(", ")})과 등기부 소유자(${owners.join(", ")})가 달라요.`],
      needs: [],
    };
  }

  const reasons: string[] = [];
  const landlordKeys = landlords.map(normalizeName);
  if (ownerKeys.some((o) => !landlordKeys.includes(o))) {
    reasons.push(`공동명의(${owners.join(", ")})인데 임대인은 그중 ${landlords.join(", ")}만이에요. 다른 소유자의 동의(위임)를 확인하세요.`);
  }
  if (input.isAgentContract) reasons.push("대리인이 계약해요. 위임장과 인감증명서로 집주인이 맡긴 것이 맞는지 확인하세요.");
  if (owners.some((o) => LANDLORD_CHECK.corporateMarkers.some((m) => o.includes(m)))) {
    reasons.push("법인 소유예요. 계약하는 사람이 법인을 대표하거나 위임받았는지 확인하세요.");
  }
  return { result: reasons.length > 0 ? "확인 필요" : "일치", reasons, needs: [] };
}

function unitKey(u: Unit) {
  const clean = (s: string | null) => (s === null ? null : s.replace(/\s|번지|^제/g, "").replace(/[동호]$/, ""));
  return { 지번: clean(u.jibun), 동: clean(u.dong) || null, 호수: clean(u.ho) };
}

function checkAddress(contract: Unit | undefined, registry: Unit | undefined): EngineResult["address"] {
  const needs = [...(contract ? [] : ["계약서 주소(동·호수)"]), ...(registry ? [] : ["등기부 주소(동·호수)"])];
  if (!contract || !registry) return { result: null, reasons: [], needs };
  const c = unitKey(contract);
  const r = unitKey(registry);
  const reasons = (["지번", "동", "호수"] as const)
    .filter((k) => c[k] !== r[k])
    .map((k) => `${k}가 달라요(계약서 ${c[k] ?? "없음"}, 등기부 ${r[k] ?? "없음"}).`);
  return { result: reasons.length > 0 ? "불일치" : "일치", reasons, needs: [] };
}

function checkGuarantee(
  input: EngineInput,
  deposit: number | undefined,
  mortgage: number | undefined,
  marketPrice: number | undefined,
  titleIssues: TitleIssue[] | undefined,
): EngineResult["guarantee"] {
  const needs: string[] = [];
  const reasons: string[] = [];
  const notes: string[] = [];
  const type = input.houseType;

  if (deposit === undefined) needs.push("보증금");
  if (input.lawdCd === undefined || !/^\d{5}$/.test(input.lawdCd)) needs.push("주소(시군구)");
  if (type === undefined) needs.push("집 종류");

  // 주택가격 (자체 해석, see HOUSE_PRICE_METHOD): 빌라는 공시가격 × 140%, 그 외는 실거래 추정 시세.
  let housePrice: number | null = null;
  if (type !== undefined) {
    if (HOUSE_PRICE_METHOD[type] === "publicPrice") {
      const ok = input.publicPrice !== undefined && Number.isFinite(input.publicPrice) && input.publicPrice > 0;
      if (ok) housePrice = (input.publicPrice as number) * HUG_GUARANTEE.publicPriceRatio;
      else needs.push("공시가격");
    } else {
      if (marketPrice !== undefined) housePrice = marketPrice;
      else needs.push("매매시세");
      notes.push(type === "officetel" ? HOUSE_PRICE_METHOD.notes.officetel : HOUSE_PRICE_METHOD.notes.apartment);
    }
  }
  if (mortgage === undefined) needs.push("근저당 채권최고액 합계");
  if (titleIssues === undefined) needs.push("등기부 갑구 기록");

  // ① 보증금 한도
  if (deposit !== undefined && input.lawdCd !== undefined && /^\d{5}$/.test(input.lawdCd)) {
    const capital = (CAPITAL_AREA_SIDO_CODES as readonly string[]).includes(input.lawdCd.slice(0, 2));
    const limit = capital ? HUG_GUARANTEE.depositLimitCapitalArea : HUG_GUARANTEE.depositLimitOther;
    if (deposit > limit) {
      reasons.push(`보증금(${won(deposit)})이 ${capital ? "수도권" : "수도권 밖"} 보증 한도(${won(limit)})를 넘어요.`);
    }
  }
  // ② (근저당 + 보증금) ≤ 주택가격 × 90%
  if (deposit !== undefined && mortgage !== undefined && housePrice !== null) {
    const cap = housePrice * HUG_GUARANTEE.ltv;
    if (mortgage + deposit > cap + 1e-9) {
      reasons.push(
        `근저당과 보증금의 합(${won(mortgage + deposit)})이 주택가격(${won(round(housePrice))})의 ${pctWhole(HUG_GUARANTEE.ltv)}(${won(round(cap))})를 넘어요.`,
      );
    }
  }
  // ③ 선순위채권 ≤ 주택가액(주택가격 × 90%) × 60%
  if (mortgage !== undefined && housePrice !== null) {
    const cap = housePrice * HUG_GUARANTEE.ltv * HUG_GUARANTEE.seniorDebtMaxRatioOfHouseValue;
    if (mortgage > cap + 1e-9) {
      reasons.push(
        `근저당(${won(mortgage)})이 주택가액(주택가격의 ${pctWhole(HUG_GUARANTEE.ltv)})의 ${pctWhole(HUG_GUARANTEE.seniorDebtMaxRatioOfHouseValue)}(${won(round(cap))})를 넘어요.`,
      );
    }
  }

  // ④ 갑구 권리침해사항 (HUG 상품개요 2쪽). 신탁 is not in HUG's list: ask HUG instead of guessing.
  const blockers = (titleIssues ?? []).filter((t) => (HUG_TITLE_CONDITION.blockers as readonly string[]).includes(t));
  if (blockers.length > 0) {
    reasons.push(
      `등기부 갑구에 ${blockers.join(", ")} 기록이 있어요. HUG는 소유권에 대한 권리침해사항(경매신청·압류·가압류·가처분·가등기 등)이 없어야 보증해요.`,
    );
  }
  const low = reasons.length > 0;
  const askHug = (titleIssues ?? []).filter((t) => (HUG_TITLE_CONDITION.askHug as readonly string[]).includes(t));
  if (askHug.length > 0) {
    reasons.push(`등기부 갑구에 ${askHug.join(", ")} 기록이 있어요. 신탁된 집은 보증에 가입할 수 있는지 HUG에 직접 확인하세요.`);
  }

  // A broken limit (or 신탁) is reported even when other values are still missing; otherwise no verdict without every value.
  const result = low ? "가입 가능성 낮음" : askHug.length > 0 ? "HUG에 직접 확인" : needs.length > 0 ? null : "기준 안에 있음";
  return { result, reasons, needs, housePrice: housePrice === null ? null : round(housePrice), notes, source: HUG_GUARANTEE.source };
}

function round(n: number): number {
  return Math.round(n);
}

// Thresholds read better without a decimal: 0.9 -> "90%".
function pctWhole(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
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
