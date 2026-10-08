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
