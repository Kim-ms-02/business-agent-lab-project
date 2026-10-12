// POST /api/market-price: looks up 실거래가 on the server and returns the estimate with its trades.
// The API key stays on the server; only the cleaned trade list is sent to the browser.
import {
  estimateMarketPrice,
  fetchTrades,
  HOUSE_TYPE_LABELS,
  MarketPriceError,
  monthsToQuery,
  type HouseType,
} from "@/data/marketPrice";
import { REGIONS } from "@/data/regions";

type Body = { type?: unknown; lawdCd?: unknown; umdNm?: unknown; jibun?: unknown; area?: unknown };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return badRequest("요청 형식이 올바르지 않습니다.");
  }

  const { type, lawdCd, umdNm, jibun, area } = body;
  if (typeof type !== "string" || !(type in HOUSE_TYPE_LABELS)) return badRequest("집 종류를 골라 주세요.");
  if (typeof lawdCd !== "string" || !REGIONS.some((r) => r.code === lawdCd)) return badRequest("시군구를 골라 주세요.");
  if (typeof umdNm !== "string" || umdNm.trim() === "") return badRequest("법정동을 입력해 주세요.");
  if (typeof jibun !== "string" || jibun.trim() === "") return badRequest("지번을 입력해 주세요.");
  if (typeof area !== "number" || !Number.isFinite(area) || area <= 0) return badRequest("전용면적은 0보다 큰 숫자로 입력해 주세요.");

  const today = seoulToday();
  try {
    const trades = await fetchTrades(type as HouseType, lawdCd, monthsToQuery(today));
    return Response.json(estimateMarketPrice(trades, { umdNm, jibun, area }, today));
  } catch (e) {
    const message = e instanceof MarketPriceError ? e.message : "실거래가를 조회하지 못했습니다.";
    return Response.json({ error: message }, { status: 502 });
  }
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
