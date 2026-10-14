// Thresholds used by the rule engine. Each value carries its source and basis date.
// When a policy changes, update this file only (and its tests).
// All money amounts are in 만원 (10,000 KRW).

export type Source = {
  source: string;
  url: string; // "URL 미확인" when the official page could not be confirmed
  basisDate: string; // YYYY-MM-DD the value was checked
  note?: string;
};

const HUG_URL = "https://www.khug.or.kr/hug/web/ig/dr/igdr000001.jsp";
const BASIS_DATE = "2026-10-08";

// HUG 담보인정비율. Shared by the senior-burden rule and the guarantee check (v0.4).
export const HUG_LTV = {
  value: 0.9,
  source: {
    source: "HUG 전세보증금반환보증 상품개요: 담보인정비율(90%)",
    url: HUG_URL,
    basisDate: BASIS_DATE,
    note: "갱신보증은 '23.12.31 신청건까지 100%, '24.1.1부터 90% 적용 (HUG 페이지 기준)",
  },
} as const;

// Rule 1: deposit / market price.
export const JEONSE_RATIO = {
  cautionAtOrAbove: 0.7,
  dangerAtOrAbove: 0.8,
  source: {
    source: "자체 기준(언론·부동산 통계에서 통용되는 깡통전세 위험선)",
    url: "URL 미확인",
    basisDate: BASIS_DATE,
  },
} as const;

// Rule 2: (mortgage max total + deposit) / market price.
export const SENIOR_BURDEN = {
  dangerAbove: HUG_LTV.value,
  source: {
    source:
      "HUG 전세보증금반환보증 가입 요건: (선순위채권+보증금) ≤ 주택가격 × 담보인정비율(90%)",
    url: HUG_URL,
    basisDate: BASIS_DATE,
  },
} as const;

// Rule 5: ownership transferred within this many calendar months before today.
export const RECENT_TRANSFER = {
  withinMonths: 3,
  source: {
    source: "자체 기준",
    url: "URL 미확인",
    basisDate: BASIS_DATE,
  },
} as const;

// v0.2 market price estimate from 실거래가 (used by src/data/marketPrice.ts, not by the engine).
export const MARKET_PRICE_METHOD = {
  months: 6, // contract date within the last 6 months, today included
  areaTolerance: 0.1, // 전용면적 ±10%
  minTrades: 3, // fewer brokered trades than this -> no estimate
  source: {
    source: "자체 기준: 같은 법정동·지번, 전용면적 ±10%, 최근 6개월 중개거래 가격의 중앙값",
    url: "URL 미확인",
    basisDate: "2026-10-13",
    note: "사용자 승인 2026-10-13",
  },
} as const;

// Rule 6 (v0.4): HUG guarantee eligibility. Shown as a warning, separate from the grade.
export const HUG_GUARANTEE = {
  depositLimitCapitalArea: 70000, // 수도권 7억원
  depositLimitOther: 50000, // 그 외 지역 5억원
  ltv: HUG_LTV.value, // (선순위채권+보증금) ≤ 주택가격 × 90%
  // 공시가격 × 140% is one way HUG prices a house (see HUG_HOUSE_PRICE_ORDER for when).
  // Combined with the 90% LTV this gives the commonly cited 126% (= 140% × 90%).
  publicPriceRatio: 1.4,
  // 선순위채권 ≤ 주택가액 × 60%, where 주택가액 = 주택가격 × 담보인정비율.
  seniorDebtMaxRatioOfHouseValue: 0.6,
  source: {
    source: "HUG 전세보증금반환보증 상품개요: 보증대상·보증한도·보증조건·주택가격 산정기준",
    url: HUG_URL,
    basisDate: BASIS_DATE,
  },
} as const;

// HUG 주택가격 산정기준, copied from the HUG page (applied in this order). Reference only.
export const HUG_HOUSE_PRICE_ORDER = {
  apartmentOfficetel: [
    "① KB시세 또는 한국부동산원 부동산테크 시세 중 선택 (상한가·하한가의 산술평균, 아파트 최저층, 주거용 오피스텔은 하한가)",
    "② 국토교통부장관이 공시하는 주택가격(오피스텔은 「소득세법」 제99조 제1항 제1호 다목에 따라 국세청장이 공시하는 가격)의 140%",
    "③ 안심전세 앱 시세의 하한가",
    "④ 해당 세대의 등기부등본상 1년 이내의 최근 매매 거래가액",
    "⑤ 분양가격의 90% (준공 후 1년이 지나지 않은 주택만)",
    "⑥ 토지 공시지가와 건물 시가표준액 합산액을 연면적 비율로 나눈 금액의 140%",
  ],
  rowhouse: [
    "① 국토교통부장관이 공시하는 공동주택가격의 140%",
    "② 안심전세 앱 시세의 하한가",
    "③ 해당 세대의 등기부등본상 1년 이내의 최근 매매 거래가액",
    "④ 토지 공시지가와 건물 시가표준액 합산액을 연면적 비율로 나눈 금액의 140%",
  ],
  note: "'22.12.31 이전 신청건은 140% 대신 150% 적용. 주거용 오피스텔은 계약서 또는 중개대상물 확인·설명서에 주거용 표기가 있어야 보증 대상.",
  source: {
    source: "HUG 전세보증금반환보증 상품개요: 주택가격 산정기준, 보증대상 주택",
    url: HUG_URL,
    basisDate: "2026-10-14",
  },
} as const;

// 자체 해석: the house price this app uses for rule 6. Not HUG's full procedure — we only have
// our 실거래 estimate and a 공시가격 the user types in (no KB / 부동산원 / 기준시가 data).
export const HOUSE_PRICE_METHOD = {
  apartment: "estimate", // 실거래 추정 시세 (HUG ①은 KB·부동산원 시세)
  rowhouse: "publicPrice", // 공시가격 × 140% only, following HUG ① for 연립·다세대
  officetel: "estimate", // 실거래 추정 시세 + officetel notice below
  notes: {
    apartment: "추정 시세 기준이라 실제 심사와 다를 수 있음",
    officetel:
      "오피스텔은 HUG 심사에서 KB·한국부동산원 시세 또는 국세청 기준시가의 140%로 집값을 정해요. " +
      "여기서는 실거래 추정 시세로 계산했기 때문에 실제 심사 결과와 다를 수 있어요. " +
      "또 계약서나 중개대상물 확인·설명서에 '주거용'이라고 적혀 있어야 보증보험에 가입할 수 있어요.",
  },
  source: {
    source: "자체 해석: 아파트·오피스텔은 실거래 추정 시세, 빌라(연립·다세대)는 공시가격 × 140% (HUG 산정 순서 참고)",
    url: HUG_URL,
    basisDate: "2026-10-14",
    note: "사용자 승인 2026-10-14. 오피스텔 안내 문구의 출처는 HUG 페이지(기준일 2026-10-14)",
  },
} as const;

// 수도권 for the deposit limit: 서울(11)·인천(28)·경기(41), matched on the first two digits
// of the 시군구 code. The code mapping is ours; "수도권" itself is HUG's term.
export const CAPITAL_AREA_SIDO_CODES = ["11", "28", "41"] as const;

// Rule 4 (v0.4): landlord name vs registered owner.
// - Normalize both names: remove spaces, parenthesized parts (e.g. 한자 병기), and middle dots (·).
// - Equal after normalization -> match. Different -> 위험.
// - "확인 필요" (주의) instead when: joint ownership and the landlord is only some of the owners,
//   the contract is signed by an agent (대리인 계약), or the owner is a corporation (법인 소유).
// - A name mismatch outranks every "확인 필요" case.
export const LANDLORD_CHECK = {
  // An owner whose name contains one of these is treated as a corporation (신탁회사 included).
  corporateMarkers: ["주식회사", "(주)", "㈜", "법인", "조합", "공사", "신탁"],
  source: {
    source: "자체 기준: 이름 정리 후 비교, 공동명의 일부·대리인·법인 소유는 확인 필요",
    url: "URL 미확인",
    basisDate: "2026-10-14",
    note: "사용자 승인 2026-10-14",
  },
} as const;
