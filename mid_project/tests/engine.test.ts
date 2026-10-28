import { describe, expect, it } from "vitest";
import { evaluate, type EngineInput } from "../src/rules/engine";

const TODAY = "2026-10-08";

// All amounts in 만원. Baseline: 전세가율 50%, 선순위 부담률 50%, no title issues, old transfer.
const safe: EngineInput = {
  deposit: 20000,
  marketPrice: 40000,
  mortgageMaxTotal: 0,
  titleIssues: [],
  noTitleIssues: true,
  ownershipTransferDate: "2020-01-01",
};

const run = (patch: Partial<EngineInput>, today = TODAY) =>
  evaluate({ ...safe, ...patch }, today);

const ruleIds = (r: ReturnType<typeof evaluate>) => r.hits.map((h) => h.ruleId);

describe("baseline", () => {
  it("returns 안전 with no hits when every value is present and below thresholds", () => {
    const r = run({});
    expect(r.grade).toBe("안전");
    expect(r.hits).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.metrics.jeonseRatio).toBe(0.5);
    expect(r.metrics.seniorBurdenRatio).toBe(0.5);
  });
});

describe("rule 1: 전세가율", () => {
  it.each([
    [6990, "안전"],
    [7000, "주의"],
    [7990, "주의"],
    [8000, "위험"],
  ])("deposit %i / price 10000 -> %s", (deposit, grade) => {
    const r = run({ deposit, marketPrice: 10000 });
    expect(r.grade).toBe(grade);
    if (grade !== "안전") {
      expect(r.hits[0]).toMatchObject({ ruleId: "jeonseRatio", grade });
    }
  });
});

describe("rule 2: 선순위 부담률", () => {
  it("exactly 90% is not a hit", () => {
    const r = run({ deposit: 5000, mortgageMaxTotal: 4000, marketPrice: 10000 });
    expect(r.metrics.seniorBurdenRatio).toBe(0.9);
    expect(ruleIds(r)).not.toContain("seniorBurden");
    expect(r.grade).toBe("안전");
  });

  it("above 90% is 위험", () => {
    const r = run({ deposit: 5000, mortgageMaxTotal: 4001, marketPrice: 10000 });
    expect(r.grade).toBe("위험");
    expect(r.hits).toEqual([
      expect.objectContaining({ ruleId: "seniorBurden", grade: "위험" }),
    ]);
  });
});

describe("rule 3: 갑구 위험 기재", () => {
  it.each(["가압류", "압류", "가처분", "경매개시결정", "신탁", "가등기"] as const)(
    "%s -> 위험",
    (item) => {
      const r = run({ titleIssues: [item], noTitleIssues: false });
      expect(r.grade).toBe("위험");
      expect(r.hits[0]).toMatchObject({ ruleId: "titleIssues", grade: "위험" });
      expect(r.hits[0].reason).toContain(item);
    },
  );

  it("lists every checked item in one hit", () => {
    const r = run({ titleIssues: ["압류", "신탁"], noTitleIssues: false });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0].values.items).toEqual(["압류", "신탁"]);
  });

  it("nothing checked and 해당 없음 unchecked -> missing, never 안전", () => {
    const r = run({ titleIssues: [], noTitleIssues: false });
    expect(r.grade).toBeNull();
    expect(r.missing).toEqual(["titleIssues"]);
  });

  it("해당 없음 together with an item -> input error", () => {
    const r = run({ titleIssues: ["압류"], noTitleIssues: true });
    expect(r.grade).toBeNull();
    expect(r.errors.map((e) => e.field)).toEqual(["titleIssues"]);
  });
});

describe("rule 5: 최근 소유권 이전", () => {
  it.each([
    ["2026-07-08", true], // exactly 3 months before today is included
    ["2026-07-07", false],
    ["2026-10-08", true], // today
  ])("transfer on %s -> hit %s", (date, hit) => {
    const r = run({ ownershipTransferDate: date });
    expect(ruleIds(r).includes("recentTransfer")).toBe(hit);
    expect(r.grade).toBe(hit ? "주의" : "안전");
  });

  it("clamps the cutoff to the end of a shorter month", () => {
    // 2026-05-31 minus 3 months -> 2026-02-28
    expect(ruleIds(run({ ownershipTransferDate: "2026-02-28" }, "2026-05-31"))).toContain(
      "recentTransfer",
    );
    expect(ruleIds(run({ ownershipTransferDate: "2026-02-27" }, "2026-05-31"))).not.toContain(
      "recentTransfer",
    );
  });

  it("future date -> input error", () => {
    const r = run({ ownershipTransferDate: "2026-10-09" });
    expect(r.grade).toBeNull();
    expect(r.errors.map((e) => e.field)).toEqual(["ownershipTransferDate"]);
  });

  it.each(["2026-13-01", "2026-02-30", "20260101", ""])("invalid date %j -> input error", (d) => {
    const r = run({ ownershipTransferDate: d });
    expect(r.errors.map((e) => e.field)).toEqual(["ownershipTransferDate"]);
  });
});

describe("final grade", () => {
  it("takes the highest grade and lists every hit", () => {
    const r = run({
      deposit: 7000,
      marketPrice: 10000,
      titleIssues: ["가처분"],
      noTitleIssues: false,
    });
    expect(r.grade).toBe("위험");
    expect(ruleIds(r)).toEqual(["jeonseRatio", "titleIssues"]);
  });
});

describe("missing values", () => {
  it("empty input -> no grade, every field missing", () => {
    const r = evaluate({}, TODAY);
    expect(r.grade).toBeNull();
    expect(r.missing).toEqual([
      "deposit",
      "marketPrice",
      "mortgageMaxTotal",
      "titleIssues",
      "ownershipTransferDate",
    ]);
  });

  it("missing value without a 위험 hit -> no grade", () => {
    const r = run({ marketPrice: undefined });
    expect(r.grade).toBeNull();
    expect(r.missing).toEqual(["marketPrice"]);
    expect(r.metrics.jeonseRatio).toBeUndefined();
  });

  it("keeps 주의 hits visible even when the grade is withheld", () => {
    const r = run({ mortgageMaxTotal: undefined, ownershipTransferDate: "2026-09-01" });
    expect(r.grade).toBeNull();
    expect(r.missing).toEqual(["mortgageMaxTotal"]);
    expect(ruleIds(r)).toEqual(["recentTransfer"]);
  });

  it("위험 hit + missing value -> 위험 with the missing list", () => {
    const r = run({
      marketPrice: undefined,
      titleIssues: ["신탁"],
      noTitleIssues: false,
    });
    expect(r.grade).toBe("위험");
    expect(r.missing).toEqual(["marketPrice"]);
  });

  it("전세가율 위험 still applies when only the mortgage is missing", () => {
    const r = run({ deposit: 8000, marketPrice: 10000, mortgageMaxTotal: undefined });
    expect(r.grade).toBe("위험");
    expect(r.missing).toEqual(["mortgageMaxTotal"]);
    expect(r.metrics.seniorBurdenRatio).toBeUndefined();
  });
});

describe("input errors", () => {
  it.each([
    ["marketPrice", 0],
    ["deposit", 0],
    ["deposit", -100],
    ["deposit", 1000.5],
    ["mortgageMaxTotal", -1],
  ] as const)("%s = %d -> input error, no grade", (field, value) => {
    const r = run({ [field]: value });
    expect(r.grade).toBeNull();
    expect(r.errors.map((e) => e.field)).toEqual([field]);
  });

  it("mortgage 0 is valid (no 근저당)", () => {
    expect(run({ mortgageMaxTotal: 0 }).errors).toEqual([]);
  });

  it("an input error does not hide a 위험 hit from other values", () => {
    const r = run({ mortgageMaxTotal: -1, titleIssues: ["압류"], noTitleIssues: false });
    expect(r.grade).toBe("위험");
    expect(r.errors.map((e) => e.field)).toEqual(["mortgageMaxTotal"]);
  });
});

// ---------- v0.4: contract vs 등기부 (rule 4), 주소 대조, 보증보험 (rule 6) ----------
// 테스트용 가상 데이터: names and addresses mirror tests/fixtures/fake-11 ~ fake-15.

describe("rule 4: 집주인 대조", () => {
  const owner = { ownerNames: ["홍길동"], landlordNames: ["홍길동"], isAgentContract: false };

  it("same name -> 일치, no hit, grade unchanged", () => {
    const r = run(owner);
    expect(r.landlord).toEqual({ result: "일치", reasons: [], needs: [] });
    expect(ruleIds(r)).not.toContain("landlord");
    expect(r.grade).toBe("안전");
  });

  it.each([
    ["홍 길 동", "홍길동"],
    ["홍길동(洪吉童)", "홍길동"],
    ["홍·길동", "홍길동"],
  ])("normalizes %j to match %j", (landlord, registered) => {
    expect(run({ ...owner, landlordNames: [landlord], ownerNames: [registered] }).landlord.result).toBe("일치");
  });

  it("different name -> 위험: 집주인 불일치", () => {
    const r = run({ ...owner, landlordNames: ["김철수"] });
    expect(r.landlord.result).toBe("불일치");
    expect(r.grade).toBe("위험");
    const hit = r.hits.find((h) => h.ruleId === "landlord");
    expect(hit?.grade).toBe("위험");
    expect(hit?.reason).toContain("위험: 집주인 불일치");
    expect(hit?.reason).toContain("김철수");
  });

  it("one letter off is still a mismatch (names were confirmed by the user)", () => {
    expect(run({ ...owner, landlordNames: ["홍길둥"] }).landlord.result).toBe("불일치");
  });

  it("joint ownership, landlord is only one of the owners -> 주의 + 확인 필요", () => {
    const r = run({ ownerNames: ["김영희", "박철수"], landlordNames: ["김영희"], isAgentContract: false });
    expect(r.landlord.result).toBe("확인 필요");
    expect(r.grade).toBe("주의");
    const hit = r.hits.find((h) => h.ruleId === "landlord");
    expect(hit?.grade).toBe("주의");
    expect(hit?.reason).toContain("확인 필요");
    expect(hit?.reason).toContain("공동명의");
  });

  it("joint ownership with every owner on the contract -> 일치", () => {
    expect(
      run({ ownerNames: ["김영희", "박철수"], landlordNames: ["박철수", "김영희"], isAgentContract: false }).landlord.result,
    ).toBe("일치");
  });

  it("agent contract -> 확인 필요 even when the name matches", () => {
    const r = run({ ...owner, isAgentContract: true });
    expect(r.landlord.result).toBe("확인 필요");
    expect(r.landlord.reasons.join(" ")).toContain("대리인");
  });

  it("corporate owner (신탁회사 included) -> 확인 필요", () => {
    const r = run({ ownerNames: ["샘플부동산신탁주식회사"], landlordNames: ["샘플부동산신탁주식회사"], isAgentContract: false });
    expect(r.landlord.result).toBe("확인 필요");
    expect(r.landlord.reasons.join(" ")).toContain("법인");
  });

  it("lists every 확인 필요 reason at once (fake-14: 공동명의 + 대리인)", () => {
    const r = run({ ownerNames: ["김영희", "박철수"], landlordNames: ["김영희"], isAgentContract: true });
    expect(r.landlord.reasons).toHaveLength(2);
    expect(r.hits.filter((h) => h.ruleId === "landlord")).toHaveLength(1);
  });

  it("a mismatch outranks 확인 필요 (agent + different name -> 위험)", () => {
    const r = run({ ...owner, landlordNames: ["김철수"], isAgentContract: true });
    expect(r.landlord.result).toBe("불일치");
    expect(r.grade).toBe("위험");
  });

  it("without contract or 등기부 names -> no result, the needed values are listed, grade unaffected", () => {
    const r = run({ ownerNames: ["홍길동"] });
    expect(r.landlord).toEqual({ result: null, reasons: [], needs: ["임대인 이름"] });
    expect(r.grade).toBe("안전");
    expect(r.missing).toEqual([]);
  });
});

describe("주소 대조 (지번·동·호수)", () => {
  const base = {
    contractUnit: { jibun: "9101", dong: "101", ho: "1203" },
    registryUnit: { jibun: "9101", dong: "101", ho: "1203" },
  };

  it("same 지번·동·호수 -> 일치", () => {
    const r = run(base);
    expect(r.address).toEqual({ result: "일치", reasons: [], needs: [] });
    expect(ruleIds(r)).not.toContain("address");
  });

  it("ignores 제·동·호·번지 and spaces", () => {
    const r = run({
      contractUnit: { jibun: "9101번지", dong: "제101동", ho: "제 1203호" },
      registryUnit: { jibun: "9101", dong: "101", ho: "1203" },
    });
    expect(r.address.result).toBe("일치");
  });

  it.each([
    ["호수", { ho: "1204" }],
    ["동", { dong: "102" }],
    ["지번", { jibun: "9102" }],
  ])("different %s -> 주의 + 확인 필요: 주소 불일치", (part, patch) => {
    const r = run({ ...base, contractUnit: { ...base.contractUnit, ...patch } });
    expect(r.address.result).toBe("불일치");
    expect(r.grade).toBe("주의");
    const hit = r.hits.find((h) => h.ruleId === "address");
    expect(hit?.grade).toBe("주의");
    expect(hit?.reason).toContain("확인 필요: 주소 불일치");
    expect(hit?.reason).toContain(part);
  });

  it("a 동 on one side only is a difference", () => {
    expect(run({ ...base, contractUnit: { ...base.contractUnit, dong: null } }).address.result).toBe("불일치");
  });

  it("villa without 동 on both sides -> 일치", () => {
    const unit = { jibun: "9202", dong: null, ho: "302" };
    expect(run({ contractUnit: unit, registryUnit: unit }).address.result).toBe("일치");
  });

  it("missing side -> needs, no hit", () => {
    const r = run({ contractUnit: base.contractUnit });
    expect(r.address).toEqual({ result: null, reasons: [], needs: ["등기부 주소(동·호수)"] });
  });
});

describe("계약서 보증금 vs 판정 보증금", () => {
  it("reports a difference", () => {
    expect(run({ deposit: 20000, contractDeposit: 40000 }).depositMismatch).toEqual({ contract: 40000, entered: 20000 });
  });

  it("no report when equal or when the contract value is missing", () => {
    expect(run({ deposit: 20000, contractDeposit: 20000 }).depositMismatch).toBeNull();
    expect(run({ deposit: 20000 }).depositMismatch).toBeNull();
  });
});

describe("rule 6: 보증보험 가입 가능성", () => {
  // 수도권 apartment: deposit 2억, 근저당 0, 시세 4억 -> every condition passes.
  const ok = { deposit: 20000, mortgageMaxTotal: 0, marketPrice: 40000, houseType: "apartment" as const, lawdCd: "11710" };

  it("within every limit -> 기준 안에 있음, shows the source and the 직접 넣은 집값 note", () => {
    const g = run(ok).guarantee;
    expect(g.result).toBe("기준 안에 있음");
    expect(g.housePrice).toBe(40000);
    expect(g.source.url).toContain("khug.or.kr");
    expect(g.notes.join(" ")).toContain("직접 넣은 집값 기준");
  });

  it.each([
    ["11710", 70001, true], // 서울 송파구
    ["11710", 70000, false],
    ["41135", 80000, true], // 경기 성남시분당구 (fake-15)
    ["28110", 70001, true], // 인천
    ["26110", 50001, true], // 부산: 그 외 지역 5억
    ["26110", 50000, false],
  ])("deposit limit: %s, 보증금 %i만원 -> over %s", (lawdCd, deposit, over) => {
    const g = run({ ...ok, lawdCd, deposit, marketPrice: 1_000_000 }).guarantee;
    expect(g.result).toBe(over ? "가입 가능성 낮음" : "기준 안에 있음");
    if (over) expect(g.reasons.join(" ")).toContain("한도");
  });

  it("(근저당 + 보증금) above 90% of the house price -> 가입 가능성 낮음", () => {
    expect(run({ ...ok, deposit: 30000, mortgageMaxTotal: 6000 }).guarantee.result).toBe("기준 안에 있음"); // 36000 = 90%
    const g = run({ ...ok, deposit: 30000, mortgageMaxTotal: 6001 }).guarantee;
    expect(g.result).toBe("가입 가능성 낮음");
    expect(g.reasons.join(" ")).toContain("90%");
  });

  it("근저당 above 60% of 주택가액 (주택가격 × 90%) -> 가입 가능성 낮음", () => {
    // 40000 × 0.9 × 0.6 = 21600
    expect(run({ ...ok, deposit: 1000, mortgageMaxTotal: 21600 }).guarantee.reasons.join(" ")).not.toContain("60%");
    const g = run({ ...ok, deposit: 1000, mortgageMaxTotal: 21601 }).guarantee;
    expect(g.result).toBe("가입 가능성 낮음");
    expect(g.reasons.join(" ")).toContain("60%");
  });

  it("villa uses 공시가격 × 140% only, never the 시세", () => {
    const villa = { ...ok, houseType: "rowhouse" as const, marketPrice: 1_000_000, publicPrice: 20000 };
    const g = run(villa).guarantee;
    expect(g.housePrice).toBe(28000);
    // 28000 × 0.9 = 25200
    expect(run({ ...villa, deposit: 25200 }).guarantee.result).toBe("기준 안에 있음");
    expect(run({ ...villa, deposit: 25201 }).guarantee.result).toBe("가입 가능성 낮음");
  });

  it("villa without 공시가격 -> 판단하려면 공시가격이 필요해요, nothing made up", () => {
    const g = run({ ...ok, houseType: "rowhouse" }).guarantee;
    expect(g.result).toBeNull();
    expect(g.needs).toEqual(["공시가격"]);
    expect(g.housePrice).toBeNull();
  });

  it("officetel uses the 시세 and always shows the officetel notice", () => {
    const g = run({ ...ok, houseType: "officetel" }).guarantee;
    expect(g.housePrice).toBe(40000);
    expect(g.notes.join(" ")).toContain("국세청 기준시가");
    expect(g.notes.join(" ")).toContain("주거용");
  });

  it("a limit already broken is reported even when other values are missing", () => {
    const g = run({ deposit: 80000, lawdCd: "41135", houseType: "officetel", marketPrice: undefined, mortgageMaxTotal: undefined })
      .guarantee;
    expect(g.result).toBe("가입 가능성 낮음");
    expect(g.needs).toEqual(["집값", "근저당 채권최고액 합계"]);
  });

  it("missing 주소 and 집 종류 -> listed as needs", () => {
    const g = run({ ...ok, lawdCd: undefined, houseType: undefined }).guarantee;
    expect(g.result).toBeNull();
    expect(g.needs).toEqual(["주소(시군구)", "집 종류"]);
  });

  it("is a separate warning: it never changes the grade", () => {
    const r = run({ ...ok, deposit: 80000, marketPrice: 1_000_000 });
    expect(r.guarantee.result).toBe("가입 가능성 낮음");
    expect(r.grade).toBe("안전");
    expect(r.hits).toEqual([]);
  });
});

describe("rule 6: 보증보험 — 갑구 권리침해 조건 (HUG 상품개요 2쪽)", () => {
  const ok = { deposit: 20000, mortgageMaxTotal: 0, marketPrice: 40000, houseType: "apartment" as const, lawdCd: "11710" };

  it.each(["압류", "가압류", "가처분", "가등기", "경매개시결정"] as const)(
    "%s in 갑구 -> 가입 가능성 낮음, and the reason names it",
    (item) => {
      const g = run({ ...ok, titleIssues: [item], noTitleIssues: false }).guarantee;
      expect(g.result).toBe("가입 가능성 낮음");
      expect(g.reasons.join(" ")).toContain(item);
      expect(g.reasons.join(" ")).toContain("권리침해");
    },
  );

  it("신탁 only -> HUG에 직접 확인", () => {
    const g = run({ ...ok, titleIssues: ["신탁"], noTitleIssues: false }).guarantee;
    expect(g.result).toBe("HUG에 직접 확인");
    expect(g.reasons.join(" ")).toContain("신탁");
  });

  it("신탁 with another 권리침해 기록 -> 가입 가능성 낮음 wins, both are named", () => {
    const g = run({ ...ok, titleIssues: ["신탁", "압류"], noTitleIssues: false }).guarantee;
    expect(g.result).toBe("가입 가능성 낮음");
    expect(g.reasons.join(" ")).toContain("압류");
    expect(g.reasons.join(" ")).toContain("신탁");
  });

  it("신탁 with a broken limit -> 가입 가능성 낮음", () => {
    const g = run({ ...ok, deposit: 80000, marketPrice: 1_000_000, titleIssues: ["신탁"], noTitleIssues: false }).guarantee;
    expect(g.result).toBe("가입 가능성 낮음");
    expect(g.reasons.join(" ")).toContain("한도");
  });

  it("신탁 is reported even when other values are missing", () => {
    const g = run({ ...ok, houseType: undefined, titleIssues: ["신탁"], noTitleIssues: false }).guarantee;
    expect(g.result).toBe("HUG에 직접 확인");
    expect(g.needs).toEqual(["집 종류"]);
  });

  it("갑구 not checked yet -> no verdict, 갑구 is listed as needed", () => {
    const g = run({ ...ok, titleIssues: undefined, noTitleIssues: undefined }).guarantee;
    expect(g.result).toBeNull();
    expect(g.needs).toContain("등기부 갑구 기록");
  });

  it("the 갑구 condition still never changes the grade", () => {
    const r = run({ ...ok, titleIssues: ["가등기"], noTitleIssues: false });
    expect(r.guarantee.result).toBe("가입 가능성 낮음");
    expect(r.hits.map((h) => h.ruleId)).toEqual(["titleIssues"]);
  });
});

// The input box is called 집값(매매가), so the reasons on screen say 집값 too.
describe("reasons say 집값, the name of the input box", () => {
  it("rule 1 and rule 2 reasons", () => {
    const r = run({ deposit: 8000, mortgageMaxTotal: 2000, marketPrice: 10000 });
    const reason = (id: string) => r.hits.find((h) => h.ruleId === id)?.reason ?? "";
    expect(reason("jeonseRatio")).toContain("보증금이 집값의 80.0%입니다.");
    expect(reason("seniorBurden")).toContain("보증금(8,000만원)을 더하면 집값의 100.0%입니다.");
    expect(r.hits.map((h) => h.reason).join(" ")).not.toContain("매매시세");
  });
});
