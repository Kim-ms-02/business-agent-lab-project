// v0.5 데모 사례 3개 (사용자 승인 2026-10-15). 테스트용 가상 데이터: fake-01/fake-11, fake-03/fake-16 기반.
// All amounts in 만원. "최근 소유권 이전" depends on the date, so tests use DEMO_TODAY.
import type { EngineInput } from "../src/rules/engine";

export const DEMO_TODAY = "2026-10-15";

const apartment: EngineInput = {
  deposit: 40000, // fake-11: 4억
  mortgageMaxTotal: 24000, // fake-01: 근저당 2억 4천만
  titleIssues: [],
  noTitleIssues: true,
  ownershipTransferDate: "2018-06-11",
  landlordNames: ["홍길동"],
  ownerNames: ["홍길동"],
  isAgentContract: false,
  contractUnit: { jibun: "9101", dong: "101", ho: "1203" },
  registryUnit: { jibun: "9101", dong: "101", ho: "1203" },
  contractDeposit: 40000,
  houseType: "apartment",
  lawdCd: "11710",
};

export const DEMO_CASES = {
  // 전세가율 50.0%, 선순위 부담률 80.0% -> 안전, 보증보험 기준 안
  safe: { ...apartment, marketPrice: 80000 },
  // 전세가율 88.9%, 선순위 부담률 142.2% -> 위험, 보증보험 가입 가능성 낮음
  kkangtong: { ...apartment, marketPrice: 45000 },
  // fake-03 + fake-16: 전세가율 74.1%, 선순위 74.1%, 신탁, 최근 이전, 법인 소유 -> 위험
  trust: {
    deposit: 20000,
    marketPrice: 27000,
    mortgageMaxTotal: 0,
    titleIssues: ["신탁"],
    noTitleIssues: false,
    ownershipTransferDate: "2026-08-20",
    landlordNames: ["샘플부동산신탁주식회사"],
    ownerNames: ["샘플부동산신탁주식회사"],
    isAgentContract: false,
    contractUnit: { jibun: "9303", dong: null, ho: "805" },
    registryUnit: { jibun: "9303", dong: null, ho: "805" },
    contractDeposit: 20000,
    houseType: "officetel",
    lawdCd: "41135",
  },
} satisfies Record<string, EngineInput>;

// fake-03 을구 1: 전세권 (전세금 2억). Comes from the 등기부 review, not from the engine.
export const TRUST_TENANCIES = [{ kind: "전세권" as const, amountWon: 200_000_000 }];
