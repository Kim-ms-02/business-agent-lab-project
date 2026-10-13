// 등기부 -> values with their source text.
// The AI only copies text out of the document (RawExtraction). Everything after that —
// format checks, 원 -> 만원, totals, region codes, "확인 필요" flags — is done here in plain code.
import { parseKoreanDate } from "../app/parseDate";
import type { HouseType } from "../data/marketPrice";
import { REGIONS } from "../data/regions";
import { TITLE_ISSUES, type TitleIssue } from "../rules/engine";

// ---------- what the AI returns ----------

export type Confidence = "certain" | "uncertain";
export type DocumentStatus = "ok" | "not_registry" | "not_collective_building" | "unreadable";
export type TenancyKind = "전세권" | "임차권";

type Sourced = { quote: string | null; location: string | null; confidence: Confidence; note: string | null };
export type RawField = Sourced & { value: string | null };

export type RawExtraction = {
  documentStatus: DocumentStatus;
  statusNote: string | null;
  address: RawField; // 지번 주소 (표제부 소재지번)
  buildingUsage: RawField; // 1동 건물내역
  exclusiveArea: RawField; // 전유부분 면적 text, e.g. "59.87㎡"
  owners: Sourced & { items: { role: string; name: string; share: string | null }[] };
  ownershipTransfer: Sourced & { receiptDate: string | null; causeDate: string | null; cause: string | null };
  sections: { gapgu: "complete" | "incomplete"; eulgu: "complete" | "absent" | "incomplete" };
  titleIssues: { kind: TitleIssue; quote: string; location: string | null; confidence: Confidence }[];
  mortgages: {
    amount: string;
    creditor: string | null;
    quote: string;
    location: string | null;
    confidence: Confidence;
    changes: { amount: string | null; quote: string; location: string | null }[];
  }[];
  tenancies: {
    kind: TenancyKind;
    amount: string | null;
    holder: string | null;
    quote: string;
    location: string | null;
    confidence: Confidence;
  }[];
  cancelled: { location: string | null; purpose: string; quote: string }[];
};

// ---------- what the review screen shows ----------

export type Evidence = { quote: string; location: string | null };
export type Reviewed<T> = { value: T | null; evidence: Evidence[]; needsCheck: boolean; reasons: string[] };

export type AddressParts = {
  text: string;
  lawdCd: string | null;
  sido: string | null;
  sigungu: string | null;
  umdNm: string | null;
  jibun: string | null;
};

export type MortgageItem = {
  creditor: string | null;
  originalWon: number | null;
  finalWon: number | null;
  finalManwon: number | null;
  changed: boolean;
  evidence: Evidence[];
  needsCheck: boolean;
  reasons: string[];
};

export type TenancyItem = {
  kind: TenancyKind;
  amountWon: number | null;
  holder: string | null;
  evidence: Evidence[];
  needsCheck: true;
  reasons: string[];
};

export type ReviewOk = {
  status: "ok";
  owners: Reviewed<RawExtraction["owners"]["items"]>;
  address: Reviewed<AddressParts>;
  houseType: Reviewed<HouseType>;
  area: Reviewed<number>;
  ownershipTransfer: Reviewed<{ receiptDate: string; causeDate: string | null; cause: string | null }>;
  titleIssues: Reviewed<TitleIssue[]> & { noIssues: boolean };
  mortgages: MortgageItem[];
  mortgageTotal: Reviewed<number>;
  tenancies: TenancyItem[];
  cancelled: RawExtraction["cancelled"];
};

export type Review = ReviewOk | { status: Exclude<DocumentStatus, "ok">; message: string };

const STATUS_MESSAGES: Record<Exclude<DocumentStatus, "ok">, string> = {
  unreadable: "글자를 알아볼 수 없어요. 서류 전체가 잘리지 않게, 밝은 곳에서 다시 찍어 주세요.",
  not_collective_building:
    "지원하지 않는 서류예요. 지금은 아파트·빌라·오피스텔 같은 집합건물 등기부만 읽을 수 있어요.",
  not_registry: "등기부등본이 아닌 것 같아요. 등기사항전부증명서를 올려 주세요.",
};

const NOT_FOUND = "서류에서 찾지 못했어요.";

// ---------- small parsers ----------

// "금52,345,000원" -> 52345000. Anything that is not plainly a number of 원 -> null.
export function parseWon(text: string): number | null {
  const digits = text.replace(/\s/g, "").replace(/^금/, "").replace(/원$/, "").replace(/,/g, "");
  return /^\d+$/.test(digits) ? Number(digits) : null;
}

// Rounds up so that a 근저당 is never shown smaller than it is.
export function wonToManwonCeil(won: number): number {
  return Math.ceil(won / 10000);
}

// Exactly one area in the text, e.g. "철근콘크리트구조 59.87㎡" -> 59.87. None or several -> null.
export function parseArea(text: string): number | null {
  const found = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:㎡|m²|m2)/g)];
  if (found.length !== 1) return null;
  const area = Number(found[0][1]);
  return area > 0 ? area : null;
}

export function houseTypeFromUsage(usage: string): HouseType | null {
  if (usage.includes("오피스텔")) return "officetel";
  if (usage.includes("아파트")) return "apartment";
  if (usage.includes("다세대") || usage.includes("연립")) return "rowhouse";
  return null;
}

const UMD_TOKEN = /(동|\d*가|리|읍|면)$/;
const JIBUN_TOKEN = /^(산?\d+(?:-\d+)?)(?:번지)?$/;

// "경기도 성남시 분당구 정자동 9303" -> 41135 / 정자동 / 9303. Parts it cannot find stay null.
export function splitAddress(text: string): AddressParts {
  const empty: AddressParts = { text, lawdCd: null, sido: null, sigungu: null, umdNm: null, jibun: null };
  const [sido, ...rest] = text.trim().split(/\s+/);
  const candidates = REGIONS.filter((r) => r.sido === sido);
  if (candidates.length === 0) return empty;

  // 시군구 may be written with spaces ("성남시 분당구") while the list has none ("성남시분당구").
  let region: (typeof REGIONS)[number] | undefined;
  let used = 0;
  for (const k of [2, 1]) {
    const joined = rest.slice(0, k).join("");
    const match = candidates.find((r) => r.sigungu === joined);
    if (match) {
      region = match;
      used = k;
      break;
    }
  }
  // A 시도 with a single code (세종) has no 시군구 in the address.
  if (!region && candidates.length === 1) region = candidates[0];
  if (!region) return empty;

  const tail = rest.slice(used);
  const umd: string[] = [];
  let i = 0;
  while (i < tail.length && UMD_TOKEN.test(tail[i]) && !JIBUN_TOKEN.test(tail[i])) umd.push(tail[i++]);
  const jibun = i < tail.length ? (JIBUN_TOKEN.exec(tail[i])?.[1] ?? null) : null;

  return {
    text,
    lawdCd: region.code,
    sido: region.sido,
    sigungu: region.sigungu,
    umdNm: umd.length > 0 ? umd.join(" ") : null,
    jibun,
  };
}

// ---------- format check of the AI answer ----------

export type Validation = { ok: true; data: RawExtraction } | { ok: false; error: string };

export function validateRawExtraction(value: unknown): Validation {
  const problems: string[] = [];
  const need = (cond: boolean, path: string) => {
    if (!cond) problems.push(path);
  };

  if (!isObject(value)) return { ok: false, error: "응답이 객체가 아닙니다." };
  need(isOneOf(value.documentStatus, ["ok", "not_registry", "not_collective_building", "unreadable"]), "documentStatus");
  need(isStrOrNull(value.statusNote), "statusNote");
  for (const key of ["address", "buildingUsage", "exclusiveArea"] as const) {
    need(isSourced(value[key]) && isStrOrNull((value[key] as Record<string, unknown>).value), key);
  }

  const owners = value.owners;
  need(
    isSourced(owners) &&
      isArrayOf(owners.items, (o) => isObject(o) && isStr(o.role) && isStr(o.name) && isStrOrNull(o.share)),
    "owners",
  );

  const transfer = value.ownershipTransfer;
  need(
    isSourced(transfer) && isStrOrNull(transfer.receiptDate) && isStrOrNull(transfer.causeDate) && isStrOrNull(transfer.cause),
    "ownershipTransfer",
  );

  const sections = value.sections;
  need(
    isObject(sections) &&
      isOneOf(sections.gapgu, ["complete", "incomplete"]) &&
      isOneOf(sections.eulgu, ["complete", "absent", "incomplete"]),
    "sections",
  );

  need(
    isArrayOf(value.titleIssues, (t) => isQuoted(t) && isOneOf(t.kind, TITLE_ISSUES) && isConfidence(t.confidence)),
    "titleIssues",
  );
  need(
    isArrayOf(
      value.mortgages,
      (m) =>
        isQuoted(m) &&
        isStr(m.amount) &&
        isStrOrNull(m.creditor) &&
        isConfidence(m.confidence) &&
        isArrayOf(m.changes, (c) => isQuoted(c) && isStrOrNull(c.amount)),
    ),
    "mortgages",
  );
  need(
    isArrayOf(
      value.tenancies,
      (t) =>
        isQuoted(t) &&
        isOneOf(t.kind, ["전세권", "임차권"]) &&
        isStrOrNull(t.amount) &&
        isStrOrNull(t.holder) &&
        isConfidence(t.confidence),
    ),
    "tenancies",
  );
  need(isArrayOf(value.cancelled, (c) => isQuoted(c) && isStr(c.purpose)), "cancelled");

  return problems.length === 0
    ? { ok: true, data: value as RawExtraction }
    : { ok: false, error: `응답 형식이 맞지 않습니다: ${problems.join(", ")}` };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isStr(v: unknown): v is string {
  return typeof v === "string";
}
function isStrOrNull(v: unknown): v is string | null {
  return v === null || typeof v === "string";
}
function isOneOf<T extends string>(v: unknown, options: readonly T[]): v is T {
  return typeof v === "string" && (options as readonly string[]).includes(v);
}
function isConfidence(v: unknown): v is Confidence {
  return isOneOf(v, ["certain", "uncertain"]);
}
function isArrayOf(v: unknown, check: (item: Record<string, unknown>) => boolean): boolean {
  return Array.isArray(v) && v.every((item) => isObject(item) && check(item));
}
function isSourced(v: unknown): v is Record<string, unknown> {
  return (
    isObject(v) && isStrOrNull(v.quote) && isStrOrNull(v.location) && isConfidence(v.confidence) && isStrOrNull(v.note)
  );
}
// Items in a list always carry their quote.
function isQuoted(v: Record<string, unknown>): boolean {
  return isStr(v.quote) && isStrOrNull(v.location);
}

// ---------- AI answer -> review data ----------

export function buildReview(raw: RawExtraction): Review {
  if (raw.documentStatus !== "ok") {
    // Values read from an unusable document are dropped, never shown.
    return { status: raw.documentStatus, message: STATUS_MESSAGES[raw.documentStatus] };
  }

  const mortgages = raw.mortgages.map(reviewMortgage);

  return {
    status: "ok",
    owners: reviewed(raw.owners, raw.owners.items.length > 0 ? raw.owners.items : null),
    address: reviewAddress(raw.address),
    houseType: reviewHouseType(raw.buildingUsage),
    area: reviewArea(raw.exclusiveArea),
    ownershipTransfer: reviewTransfer(raw.ownershipTransfer),
    titleIssues: reviewTitleIssues(raw),
    mortgages,
    mortgageTotal: reviewMortgageTotal(raw.sections.eulgu, mortgages),
    tenancies: raw.tenancies.map((t) => ({
      kind: t.kind,
      amountWon: t.amount === null ? null : parseWon(t.amount),
      holder: t.holder,
      evidence: [{ quote: t.quote, location: t.location }],
      needsCheck: true,
      reasons: [`${t.kind} 기재가 있어요. 내용을 꼭 확인해 주세요.`],
    })),
    cancelled: raw.cancelled,
  };
}

// Base flags shared by every single-value field: AI unsure, or nothing found.
function reviewed<T>(src: Sourced, value: T | null, extraReasons: string[] = []): Reviewed<T> {
  const reasons: string[] = [];
  if (src.confidence === "uncertain") reasons.push(src.note ? `AI가 확신하지 못했어요: ${src.note}` : "AI가 확신하지 못했어요.");
  if (value === null && extraReasons.length === 0) reasons.push(NOT_FOUND);
  reasons.push(...extraReasons);
  return {
    value,
    evidence: src.quote ? [{ quote: src.quote, location: src.location }] : [],
    needsCheck: reasons.length > 0,
    reasons,
  };
}

function reviewAddress(src: RawField): Reviewed<AddressParts> {
  if (src.value === null) return reviewed<AddressParts>(src, null);
  const parts = splitAddress(src.value);
  const extra: string[] = [];
  if (parts.lawdCd === null) extra.push("시군구를 찾지 못했어요.");
  else if (parts.umdNm === null || parts.jibun === null) extra.push("법정동이나 지번을 찾지 못했어요.");
  else if (parts.umdNm.includes(" ")) extra.push("읍·면 지역은 시세 조회에 쓸 법정동 이름을 확인해 주세요.");
  return reviewed(src, parts, extra);
}

function reviewHouseType(src: RawField): Reviewed<HouseType> {
  if (src.value === null) return reviewed<HouseType>(src, null);
  const type = houseTypeFromUsage(src.value);
  return reviewed(src, type, type === null ? ["집 종류(아파트·빌라·오피스텔)를 알 수 없어요."] : []);
}

function reviewArea(src: RawField): Reviewed<number> {
  if (src.value === null) return reviewed<number>(src, null);
  const area = parseArea(src.value);
  return reviewed(src, area, area === null ? ["면적을 숫자로 읽지 못했어요."] : []);
}

type TransferValue = NonNullable<ReviewOk["ownershipTransfer"]["value"]>;

function reviewTransfer(src: RawExtraction["ownershipTransfer"]): ReviewOk["ownershipTransfer"] {
  if (src.receiptDate === null) return reviewed<TransferValue>(src, null);
  const receipt = parseKoreanDate(src.receiptDate);
  if (receipt.kind !== "ok") return reviewed<TransferValue>(src, null, ["접수일을 날짜로 읽지 못했어요."]);
  const cause = src.causeDate === null ? null : parseKoreanDate(src.causeDate);
  const extra = cause !== null && cause.kind !== "ok" ? ["등기원인일을 날짜로 읽지 못했어요."] : [];
  return reviewed(
    src,
    { receiptDate: receipt.iso, causeDate: cause?.kind === "ok" ? cause.iso : null, cause: src.cause },
    extra,
  );
}

function reviewTitleIssues(raw: RawExtraction): ReviewOk["titleIssues"] {
  const found = TITLE_ISSUES.filter((kind) => raw.titleIssues.some((t) => t.kind === kind));
  const complete = raw.sections.gapgu === "complete";
  const reasons: string[] = [];
  if (raw.titleIssues.some((t) => t.confidence === "uncertain")) reasons.push("AI가 확신하지 못한 기재가 있어요.");
  if (!complete) reasons.push("갑구를 끝까지 읽지 못했어요.");
  else if (found.length === 0) reasons.push("위험 기재가 없는 것으로 읽었어요. 맞는지 확인해 주세요.");
  return {
    // Unknown (not read in full, nothing seen) is never turned into "해당 없음".
    value: !complete && found.length === 0 ? null : found,
    noIssues: complete && found.length === 0,
    evidence: raw.titleIssues.map((t) => ({ quote: t.quote, location: t.location })),
    needsCheck: reasons.length > 0,
    reasons,
  };
}

function reviewMortgage(m: RawExtraction["mortgages"][number]): MortgageItem {
  const originalWon = parseWon(m.amount);
  const amountChanges = m.changes.filter((c) => c.amount !== null);
  const last = amountChanges.at(-1);
  const finalWon = last ? parseWon(last.amount as string) : originalWon;
  const reasons: string[] = [];
  if (m.confidence === "uncertain") reasons.push("AI가 확신하지 못했어요.");
  if (finalWon === null) reasons.push("채권최고액을 읽지 못했어요.");
  return {
    creditor: m.creditor,
    originalWon,
    finalWon,
    finalManwon: finalWon === null ? null : wonToManwonCeil(finalWon),
    changed: last !== undefined,
    evidence: [{ quote: m.quote, location: m.location }, ...m.changes.map((c) => ({ quote: c.quote, location: c.location }))],
    needsCheck: reasons.length > 0,
    reasons,
  };
}

function reviewMortgageTotal(eulgu: RawExtraction["sections"]["eulgu"], items: MortgageItem[]): Reviewed<number> {
  const result = (value: number | null, reasons: string[]): Reviewed<number> => ({
    value,
    evidence: [],
    needsCheck: reasons.length > 0,
    reasons,
  });
  if (eulgu === "incomplete") return result(null, ["을구를 끝까지 읽지 못했어요."]);
  if (items.some((m) => m.finalManwon === null)) return result(null, ["읽지 못한 금액이 있어요."]);
  if (items.length === 0) return result(0, ["근저당이 없는 것으로 읽었어요. 맞는지 확인해 주세요."]);
  return result(
    items.reduce((sum, m) => sum + (m.finalManwon as number), 0),
    [],
  );
}

// Keys of the items the user must tick before the values go into the form.
export function checkKeys(r: ReviewOk): string[] {
  const keys: string[] = [];
  const single = ["owners", "address", "houseType", "area", "ownershipTransfer", "titleIssues"] as const;
  for (const k of single) if (r[k].needsCheck) keys.push(k);
  r.mortgages.forEach((m, i) => m.needsCheck && keys.push(`mortgage:${i}`));
  if (r.mortgageTotal.needsCheck) keys.push("mortgageTotal");
  r.tenancies.forEach((_t, i) => keys.push(`tenancy:${i}`));
  return keys;
}

export type FormPrefill = {
  mortgageMaxTotal: number | null;
  titleIssues: TitleIssue[];
  noTitleIssues: boolean;
  ownershipTransferDate: string | null;
  lookup: {
    type: HouseType | null;
    sido: string | null;
    lawdCd: string | null;
    umdNm: string | null;
    jibun: string | null;
    area: number | null;
  };
};

export function toFormPrefill(r: ReviewOk): FormPrefill {
  const a = r.address.value;
  return {
    mortgageMaxTotal: r.mortgageTotal.value,
    titleIssues: r.titleIssues.value ?? [],
    noTitleIssues: r.titleIssues.noIssues,
    ownershipTransferDate: r.ownershipTransfer.value?.receiptDate ?? null,
    lookup: {
      type: r.houseType.value,
      sido: a?.sido ?? null,
      lawdCd: a?.lawdCd ?? null,
      umdNm: a?.umdNm ?? null,
      jibun: a?.jibun ?? null,
      area: r.area.value,
    },
  };
}
