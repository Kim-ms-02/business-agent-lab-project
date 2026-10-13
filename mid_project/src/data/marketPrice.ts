// 실거래가 조회와 시세 추정.
// Estimation is a pure function; fetching runs on the server only (uses DATA_GO_KR_KEY).
// All money amounts are in 만원. Field names follow docs/api/fields.md.
// Method thresholds live in src/rules/config.ts (MARKET_PRICE_METHOD).

import { MARKET_PRICE_METHOD } from "../rules/config";

export type HouseType = "apartment" | "rowhouse" | "officetel";

export const HOUSE_TYPE_LABELS: Record<HouseType, string> = {
  apartment: "아파트",
  rowhouse: "빌라(연립·다세대)",
  officetel: "오피스텔",
};


const ENDPOINTS: Record<HouseType, { path: string; nameTag: string }> = {
  apartment: { path: "RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade", nameTag: "aptNm" },
  rowhouse: { path: "RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade", nameTag: "mhouseNm" },
  officetel: { path: "RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade", nameTag: "offiNm" },
};

export type Trade = {
  id: string;
  date: string; // contract date YYYY-MM-DD
  amount: number; // 만원
  area: number; // 전용면적 ㎡
  floor: string | null;
  name: string;
  umdNm: string;
  jibun: string;
  dealingGbn: string; // "중개거래" | "직거래" (observed values)
  cancelled: boolean; // cdealType "O"
};

export type Target = { umdNm: string; jibun: string; area: number };

export type Estimate = {
  estimate: number | null; // null when fewer than minTrades brokered trades match
  used: Trade[]; // brokered trades the median is taken from, newest first
  excludedDirect: Trade[]; // matching 직거래, listed but not used
  cancelledCount: number; // matching cancelled trades, dropped
  period: { from: string; to: string };
};

export function estimateMarketPrice(trades: Trade[], target: Target, today: string): Estimate {
  const from = subtractMonths(today, MARKET_PRICE_METHOD.months);
  const lo = round3(target.area * (1 - MARKET_PRICE_METHOD.areaTolerance));
  const hi = round3(target.area * (1 + MARKET_PRICE_METHOD.areaTolerance));
  const umd = normalizeUmd(target.umdNm);
  const jibun = normalizeJibun(target.jibun);

  const matching = trades.filter(
    (t) =>
      normalizeUmd(t.umdNm) === umd &&
      normalizeJibun(t.jibun) === jibun &&
      round3(t.area) >= lo &&
      round3(t.area) <= hi &&
      t.date >= from &&
      t.date <= today,
  );
  const live = matching.filter((t) => !t.cancelled);
  const byNewest = (a: Trade, b: Trade) => b.date.localeCompare(a.date);
  const used = live.filter((t) => t.dealingGbn !== "직거래").sort(byNewest);
  const excludedDirect = live.filter((t) => t.dealingGbn === "직거래").sort(byNewest);

  return {
    estimate: used.length >= MARKET_PRICE_METHOD.minTrades ? median(used.map((t) => t.amount)) : null,
    used,
    excludedDirect,
    cancelledCount: matching.length - live.length,
    period: { from, to: today },
  };
}

// Contract months (YYYYMM) to query so that the last 6 months are fully covered.
export function monthsToQuery(today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let back = MARKET_PRICE_METHOD.months; back >= 0; back--) {
    const total = y * 12 + (m - 1) - back;
    out.push(`${Math.floor(total / 12)}${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

export type ParsedPage = { resultCode: string | null; resultMsg: string | null; totalCount: number; trades: Trade[] };

export function parseTradesXml(xml: string, type: HouseType): ParsedPage {
  // Gateway errors (bad key, quota) come in a different envelope.
  const gatewayCode = tag(xml, "returnReasonCode");
  if (gatewayCode !== null) {
    return { resultCode: gatewayCode, resultMsg: tag(xml, "returnAuthMsg"), totalCount: 0, trades: [] };
  }
  const nameTag = ENDPOINTS[type].nameTag;
  const trades = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m, i): Trade => {
    const it = m[1];
    const get = (t: string) => (tag(it, t) ?? "").trim();
    return {
      id: `${get("dealYear")}${get("dealMonth")}${get("dealDay")}-${i}`,
      date: `${get("dealYear")}-${get("dealMonth").padStart(2, "0")}-${get("dealDay").padStart(2, "0")}`,
      amount: Number(get("dealAmount").replace(/,/g, "")),
      area: Number(get("excluUseAr")),
      floor: get("floor") || null,
      name: get(nameTag),
      umdNm: get("umdNm"),
      jibun: get("jibun"),
      dealingGbn: get("dealingGbn"),
      cancelled: get("cdealType") === "O",
    };
  });
  return {
    resultCode: tag(xml, "resultCode"),
    resultMsg: tag(xml, "resultMsg"),
    totalCount: Number(tag(xml, "totalCount") ?? 0),
    trades,
  };
}

export class MarketPriceError extends Error {}

// Server only: reads DATA_GO_KR_KEY. Never call from client code.
export async function fetchTrades(type: HouseType, lawdCd: string, months: string[]): Promise<Trade[]> {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) throw new MarketPriceError("실거래가 조회 설정이 되어 있지 않습니다.");
  const pageSize = 1000;
  const all: Trade[] = [];
  for (const ymd of months) {
    for (let page = 1; ; page++) {
      const url =
        `https://apis.data.go.kr/1613000/${ENDPOINTS[type].path}` +
        `?serviceKey=${encodeURIComponent(key)}&LAWD_CD=${lawdCd}&DEAL_YMD=${ymd}&pageNo=${page}&numOfRows=${pageSize}`;
      let xml: string;
      try {
        const res = await fetch(url, { cache: "no-store" });
        xml = await res.text();
      } catch {
        throw new MarketPriceError("실거래가 서버에 연결하지 못했습니다.");
      }
      const parsed = parseTradesXml(xml, type);
      if (parsed.resultCode !== "000") {
        throw new MarketPriceError(`실거래가 조회에 실패했습니다 (코드 ${parsed.resultCode ?? "알 수 없음"}).`);
      }
      all.push(...parsed.trades.map((t) => ({ ...t, id: `${ymd}-${page}-${t.id}` })));
      if (page * pageSize >= parsed.totalCount) break;
    }
  }
  return all;
}

function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeEntities(m[1]) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function normalizeUmd(s: string): string {
  return s.replace(/\s/g, "");
}

function normalizeJibun(s: string): string {
  return s.replace(/\s/g, "").replace(/번지$/, "");
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// Calendar-month subtraction on YYYY-MM-DD strings; clamps to the last day of shorter months.
function subtractMonths(date: string, months: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const total = y * 12 + (mo - 1) - months;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const td = Math.min(d, new Date(Date.UTC(ty, tm, 0)).getUTCDate());
  return `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
}
