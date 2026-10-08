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

// Rule 6 (v0.4, not used by the engine yet): HUG guarantee eligibility.
export const HUG_GUARANTEE = {
  depositLimitCapitalArea: 70000, // 수도권 7억원
  depositLimitOther: 50000, // 그 외 지역 5억원
  ltv: HUG_LTV.value, // (선순위채권+보증금) ≤ 주택가격 × 90%
  // House price from the official assessed price = 공시가격 × 140%.
  // Combined with the 90% LTV this gives the commonly cited 126% (= 140% × 90%).
  // HUG uses this only when KB / 한국부동산원 시세 is unavailable (2nd in priority).
  publicPriceRatio: 1.4,
  // 선순위채권 ≤ 주택가액 × 60%, where 주택가액 = 주택가격 × 담보인정비율.
  seniorDebtMaxRatioOfHouseValue: 0.6,
  source: {
    source: "HUG 전세보증금반환보증 상품개요: 보증대상·보증한도·보증조건·주택가격 산정기준",
    url: HUG_URL,
    basisDate: BASIS_DATE,
  },
} as const;

// Rule 4 (v0.4, not implemented yet): landlord name vs registered owner.
// - Normalize both names: remove spaces, parenthesized parts (e.g. 한자 병기), and middle dots (·).
// - Equal after normalization -> match. Different -> 위험.
// - "확인 필요" instead when: joint ownership and the landlord is one of the owners,
//   the contract is signed by an agent (대리인 계약), or the owner is a corporation (법인 소유).
