// 테스트용 가상 데이터: all trades and XML below are made up for tests.
import { describe, expect, it } from "vitest";
import {
  estimateMarketPrice,
  monthsToQuery,
  parseTradesXml,
  type Trade,
} from "../src/data/marketPrice";

const TODAY = "2026-10-13";
const TARGET = { umdNm: "가상동", jibun: "100-1", area: 84 };

let seq = 0;
const trade = (patch: Partial<Trade> = {}): Trade => ({
  date: "2026-09-01",
  amount: 50000,
  area: 84,
  floor: "5",
  name: "가상아파트",
  umdNm: "가상동",
  jibun: "100-1",
  dealingGbn: "중개거래",
  cancelled: false,
  id: `t${seq++}`,
  ...patch,
});

describe("monthsToQuery", () => {
  it("returns the 7 contract months covering the last 6 months", () => {
    expect(monthsToQuery(TODAY)).toEqual([
      "202604", "202605", "202606", "202607", "202608", "202609", "202610",
    ]);
  });

  it("crosses a year boundary", () => {
    expect(monthsToQuery("2026-02-10")[0]).toBe("202508");
  });
});

describe("parseTradesXml", () => {
  const item = (fields: Record<string, string>) =>
    `<item>${Object.entries(fields).map(([k, v]) => `<${k}>${v}</${k}>`).join("")}</item>`;
  const xml = (items: string[], totalCount = items.length) =>
    `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>` +
    `<body><items>${items.join("")}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${totalCount}</totalCount></body></response>`;
  const base = {
    umdNm: "가상동", jibun: "100-1", excluUseAr: "84.95", dealYear: "2026", dealMonth: "8",
    dealDay: "5", dealAmount: "172,500", floor: "10", cdealType: " ", cdealDay: " ", dealingGbn: "중개거래",
  };

  it("parses amount, padded date, area and the per-type name field", () => {
    const r = parseTradesXml(xml([item({ ...base, aptNm: "가상&amp;아파트" })]), "apartment");
    expect(r.resultCode).toBe("000");
    expect(r.totalCount).toBe(1);
    expect(r.trades[0]).toMatchObject({
      date: "2026-08-05", amount: 172500, area: 84.95, floor: "10",
      name: "가상&아파트", umdNm: "가상동", jibun: "100-1", dealingGbn: "중개거래", cancelled: false,
    });
  });

  it("uses mhouseNm for 연립다세대 and offiNm for 오피스텔", () => {
    expect(parseTradesXml(xml([item({ ...base, mhouseNm: "가상빌라" })]), "rowhouse").trades[0].name).toBe("가상빌라");
    expect(parseTradesXml(xml([item({ ...base, offiNm: "가상오피스텔" })]), "officetel").trades[0].name).toBe("가상오피스텔");
  });

  it("marks cdealType O as cancelled", () => {
    const r = parseTradesXml(xml([item({ ...base, aptNm: "a", cdealType: "O", cdealDay: "26.10.06" })]), "apartment");
    expect(r.trades[0].cancelled).toBe(true);
  });

  it("handles an empty result", () => {
    const r = parseTradesXml(xml([], 0), "apartment");
    expect(r.trades).toEqual([]);
    expect(r.totalCount).toBe(0);
  });

  it("reports the error code of a gateway error response", () => {
    const err =
      "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>" +
      "<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>";
    const r = parseTradesXml(err, "apartment");
    expect(r.resultCode).toBe("30");
    expect(r.trades).toEqual([]);
  });
});

describe("estimateMarketPrice", () => {
  it("takes the median of matching trades", () => {
    const r = estimateMarketPrice(
      [trade({ amount: 50000 }), trade({ amount: 52000 }), trade({ amount: 49000 })],
      TARGET,
      TODAY,
    );
    expect(r.estimate).toBe(50000);
    expect(r.used).toHaveLength(3);
  });

  it("averages the two middle values for an even count and rounds to 만원", () => {
    const r = estimateMarketPrice(
      [trade({ amount: 50000 }), trade({ amount: 50001 }), trade({ amount: 40000 }), trade({ amount: 60000 })],
      TARGET,
      TODAY,
    );
    expect(r.estimate).toBe(50001); // (50000 + 50001) / 2 = 50000.5 -> 50001
  });

  it("withholds the estimate when fewer than 3 trades match", () => {
    const r = estimateMarketPrice([trade(), trade()], TARGET, TODAY);
    expect(r.estimate).toBeNull();
    expect(r.used).toHaveLength(2);
  });

  it("only uses the same 법정동 and 지번 (ignoring spaces and 번지)", () => {
    const r = estimateMarketPrice(
      [
        trade({ jibun: "100-1" }),
        trade({ jibun: "100-2" }),
        trade({ umdNm: "다른동" }),
        trade({ umdNm: " 가상동 " }),
      ],
      { ...TARGET, jibun: " 100-1번지 " },
      TODAY,
    );
    expect(r.used).toHaveLength(2);
  });

  it("keeps trades within ±10% of the area, boundaries included", () => {
    const r = estimateMarketPrice(
      [trade({ area: 75.6 }), trade({ area: 92.4 }), trade({ area: 75.59 }), trade({ area: 92.41 })],
      TARGET,
      TODAY,
    );
    expect(r.used.map((t) => t.area).sort()).toEqual([75.6, 92.4]);
  });

  it("keeps contract dates from 6 months before today through today", () => {
    const r = estimateMarketPrice(
      [trade({ date: "2026-04-13" }), trade({ date: "2026-04-12" }), trade({ date: TODAY })],
      TARGET,
      TODAY,
    );
    expect(r.used.map((t) => t.date)).toEqual([TODAY, "2026-04-13"]);
    expect(r.period).toEqual({ from: "2026-04-13", to: TODAY });
  });

  it("drops cancelled trades entirely and counts them", () => {
    const r = estimateMarketPrice(
      [trade(), trade(), trade(), trade({ cancelled: true, amount: 1 })],
      TARGET,
      TODAY,
    );
    expect(r.cancelledCount).toBe(1);
    expect(r.used.every((t) => !t.cancelled)).toBe(true);
    expect(r.estimate).toBe(50000);
  });

  it("lists 직거래 separately and leaves it out of the calculation", () => {
    const r = estimateMarketPrice(
      [trade(), trade(), trade({ dealingGbn: "직거래", amount: 10000 })],
      TARGET,
      TODAY,
    );
    expect(r.used).toHaveLength(2);
    expect(r.excludedDirect).toHaveLength(1);
    expect(r.estimate).toBeNull(); // only 2 brokered trades remain
  });

  it("sorts used trades newest first", () => {
    const r = estimateMarketPrice(
      [trade({ date: "2026-06-01" }), trade({ date: "2026-09-01" }), trade({ date: "2026-07-15" })],
      TARGET,
      TODAY,
    );
    expect(r.used.map((t) => t.date)).toEqual(["2026-09-01", "2026-07-15", "2026-06-01"]);
  });
});
