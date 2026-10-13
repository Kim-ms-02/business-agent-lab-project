// 테스트용 가상 데이터: every extraction below is made up and mirrors tests/fixtures/fake-0*.
import { describe, expect, it } from "vitest";
import {
  buildReview,
  checkUpload,
  checkKeys,
  houseTypeFromUsage,
  parseArea,
  parseWon,
  splitAddress,
  toFormPrefill,
  validateRawExtraction,
  wonToManwonCeil,
  type RawExtraction,
  type Review,
} from "../src/agent/extract";

const field = <T>(value: T | null, quote: string | null = null, location: string | null = null) => ({
  value,
  quote,
  location,
  confidence: "certain" as const,
  note: null,
});

// Mirrors fake-02 (빌라, 위험 사례).
const villa = (): RawExtraction => ({
  documentStatus: "ok",
  statusNote: null,
  address: field("서울특별시 마포구 망원동 9202", "서울특별시 마포구 망원동 9202 가상빌라", "표제부(1동)"),
  buildingUsage: field("철근콘크리트구조 철근콘크리트평슬래브지붕 4층 다세대주택", "4층 다세대주택", "표제부(1동)"),
  exclusiveArea: field("59.87㎡", "철근콘크리트구조 59.87㎡", "표제부(전유)"),
  owners: {
    items: [
      { role: "공유자", name: "김영희", share: "2분의 1" },
      { role: "공유자", name: "박철수", share: "2분의 1" },
    ],
    quote: "공유자 지분 2분의 1 김영희 … 지분 2분의 1 박철수",
    location: "갑구 2",
    confidence: "certain",
    note: null,
  },
  ownershipTransfer: {
    receiptDate: "2020년2월14일",
    causeDate: "2020년1월10일",
    cause: "매매",
    quote: "소유권이전 2020년2월14일 제12345호 2020년1월10일 매매",
    location: "갑구 2",
    confidence: "certain",
    note: null,
  },
  sections: { gapgu: "complete", eulgu: "complete" },
  titleIssues: [
    {
      kind: "가압류",
      quote: "2번김영희지분가압류 2025년12월3일 제98765호",
      location: "갑구 5",
      confidence: "certain",
    },
  ],
  mortgages: [
    {
      amount: "금156,000,000원",
      creditor: "주식회사가상은행",
      quote: "근저당권설정 채권최고액 금156,000,000원 근저당권자 주식회사가상은행",
      location: "을구 1",
      confidence: "certain",
      changes: [{ amount: "금180,000,000원", quote: "1번근저당권변경 채권최고액 금180,000,000원", location: "을구 1-1" }],
    },
    {
      amount: "금52,345,000원",
      creditor: "테스트저축은행주식회사",
      quote: "근저당권설정 채권최고액 금52,345,000원 근저당권자 테스트저축은행주식회사",
      location: "을구 2",
      confidence: "certain",
      changes: [],
    },
  ],
  tenancies: [
    {
      kind: "임차권",
      amount: "금150,000,000원",
      holder: "심청",
      quote: "주택임차권 임차보증금 금150,000,000원 임차권자 심청",
      location: "을구 3",
      confidence: "certain",
    },
  ],
  cancelled: [{ location: "갑구 3", purpose: "압류", quote: "압류 2022년5월2일 제33010호 권리자 국" }],
});

const okReview = (raw: RawExtraction) => {
  const r = buildReview(raw);
  if (r.status !== "ok") throw new Error(`expected ok, got ${r.status}`);
  return r;
};

describe("parseWon", () => {
  it.each([
    ["금180,000,000원", 180000000],
    ["금 52,345,000 원", 52345000],
    ["240000000", 240000000],
    ["150,000,000원", 150000000],
  ])("%j -> %i", (text, won) => {
    expect(parseWon(text)).toBe(won);
  });

  it.each(["", "금원", "일억팔천만원", "금1,8O0,000원", "-5,000원"])("%j -> null", (text) => {
    expect(parseWon(text)).toBeNull();
  });
});

describe("wonToManwonCeil", () => {
  it.each([
    [240000000, 24000],
    [52345000, 5235], // 5234.5만원 -> 올림
    [10001, 2],
    [0, 0],
  ])("%i원 -> %i만원", (won, manwon) => {
    expect(wonToManwonCeil(won)).toBe(manwon);
  });
});

describe("parseArea", () => {
  it.each([
    ["84.95㎡", 84.95],
    ["철근콘크리트구조 33.12㎡", 33.12],
    ["59.87 m²", 59.87],
    ["59.87m2", 59.87],
  ])("%j -> %d", (text, area) => {
    expect(parseArea(text)).toBe(area);
  });

  it.each(["", "㎡", "0㎡", "1층 612.40㎡ 2층 598.12㎡"])("%j -> null (none or ambiguous)", (text) => {
    expect(parseArea(text)).toBeNull();
  });
});

describe("houseTypeFromUsage", () => {
  it.each([
    ["철근콘크리트구조 (철근)콘크리트지붕 15층 아파트", "apartment"],
    ["4층 다세대주택", "rowhouse"],
    ["3층 연립주택", "rowhouse"],
    ["20층 업무시설(오피스텔)", "officetel"],
    ["오피스텔 및 근린생활시설", "officetel"],
    ["2층 단독주택", null],
    ["", null],
  ])("%j -> %s", (usage, type) => {
    expect(houseTypeFromUsage(usage)).toBe(type);
  });
});

describe("splitAddress", () => {
  it("finds the 시군구 code, 법정동 and 지번", () => {
    expect(splitAddress("서울특별시 송파구 가락동 9101")).toEqual({
      text: "서울특별시 송파구 가락동 9101",
      lawdCd: "11710",
      sido: "서울특별시",
      sigungu: "송파구",
      umdNm: "가락동",
      jibun: "9101",
    });
  });

  it("matches a 시군구 stored without spaces (성남시 분당구 -> 성남시분당구)", () => {
    expect(splitAddress("경기도 성남시 분당구 정자동 9303")).toMatchObject({
      lawdCd: "41135",
      sigungu: "성남시분당구",
      umdNm: "정자동",
      jibun: "9303",
    });
  });

  it("uses the 시도 to tell apart 시군구 with the same name (중구)", () => {
    expect(splitAddress("부산광역시 중구 중앙동1가 9")?.lawdCd).toBe("26110");
    expect(splitAddress("서울특별시 중구 명동1가 9")?.lawdCd).toBe("11140");
  });

  it("handles a 시도 with a single 시군구 code (세종)", () => {
    expect(splitAddress("세종특별자치시 어진동 9")).toMatchObject({ lawdCd: "36110", umdNm: "어진동", jibun: "9" });
  });

  it("stops at the 지번 and ignores the building name and 번지", () => {
    expect(splitAddress("서울특별시 마포구 망원동 9202-3번지 가상빌라 제3층")).toMatchObject({
      umdNm: "망원동",
      jibun: "9202-3",
    });
  });

  it("keeps 읍·면 and 리 together as the 법정동", () => {
    expect(splitAddress("경기도 양평군 양평읍 양근리 99")).toMatchObject({ umdNm: "양평읍 양근리", jibun: "99" });
  });

  it("leaves parts it cannot find empty instead of guessing", () => {
    expect(splitAddress("가상도 가상시 가상동 1")).toMatchObject({ lawdCd: null, umdNm: null, jibun: null });
    expect(splitAddress("서울특별시 송파구 가락동")).toMatchObject({ lawdCd: "11710", umdNm: "가락동", jibun: null });
  });
});

describe("validateRawExtraction", () => {
  it("accepts a well-formed extraction", () => {
    const r = validateRawExtraction(JSON.parse(JSON.stringify(villa())));
    expect(r.ok).toBe(true);
  });

  it.each([
    ["not an object", "hello"],
    ["unknown status", { ...villa(), documentStatus: "maybe" }],
    ["unknown title issue", { ...villa(), titleIssues: [{ ...villa().titleIssues[0], kind: "근저당" }] }],
    ["mortgages not a list", { ...villa(), mortgages: null }],
    ["missing sections", { ...villa(), sections: undefined }],
    ["bad confidence", { ...villa(), address: { ...villa().address, confidence: "high" } }],
  ])("rejects %s", (_label, value) => {
    const r = validateRawExtraction(value);
    expect(r.ok).toBe(false);
  });
});

describe("buildReview: document status", () => {
  it.each([
    ["unreadable", "다시 찍어"],
    ["not_collective_building", "지원하지 않는 서류"],
    ["not_registry", "등기부등본이 아닌"],
  ] as const)("%s -> message containing %j and no values", (documentStatus, text) => {
    const r = buildReview({ ...villa(), documentStatus });
    expect(r.status).toBe(documentStatus);
    expect(r).not.toHaveProperty("mortgages");
    if (r.status !== "ok") expect(r.message).toContain(text);
  });
});

describe("buildReview: values from fake-02", () => {
  it("reads every owner with their share", () => {
    const r = okReview(villa());
    expect(r.owners.value).toEqual([
      { role: "공유자", name: "김영희", share: "2분의 1" },
      { role: "공유자", name: "박철수", share: "2분의 1" },
    ]);
    expect(r.owners.evidence[0]).toEqual({ quote: villa().owners.quote, location: "갑구 2" });
  });

  it("uses the final (changed) 채권최고액 and keeps both entries as evidence", () => {
    const [first, second] = okReview(villa()).mortgages;
    expect(first).toMatchObject({ originalWon: 156000000, finalWon: 180000000, finalManwon: 18000, changed: true });
    expect(first.evidence.map((e) => e.location)).toEqual(["을구 1", "을구 1-1"]);
    expect(second).toMatchObject({ finalWon: 52345000, finalManwon: 5235, changed: false });
  });

  it("sums the final amounts in 만원 for the form", () => {
    expect(okReview(villa()).mortgageTotal.value).toBe(23235);
  });

  it("takes the 접수일 as the transfer date and shows the 등기원인일 too", () => {
    const t = okReview(villa()).ownershipTransfer;
    expect(t.value).toEqual({ receiptDate: "2020-02-14", causeDate: "2020-01-10", cause: "매매" });
  });

  it("lists title issues and does not tick 해당 없음", () => {
    const r = okReview(villa());
    expect(r.titleIssues.value).toEqual(["가압류"]);
    expect(r.titleIssues.noIssues).toBe(false);
  });

  it("splits the address and picks the house type", () => {
    const r = okReview(villa());
    expect(r.address.value).toMatchObject({ lawdCd: "11440", umdNm: "망원동", jibun: "9202" });
    expect(r.houseType.value).toBe("rowhouse");
    expect(r.area.value).toBe(59.87);
  });

  it("always flags 전세권·임차권 for checking", () => {
    const [t] = okReview(villa()).tenancies;
    expect(t).toMatchObject({ kind: "임차권", amountWon: 150000000, holder: "심청", needsCheck: true });
  });

  it("passes cancelled entries through without using them", () => {
    const r = okReview(villa());
    expect(r.cancelled).toEqual(villa().cancelled);
    expect(r.titleIssues.value).not.toContain("압류");
  });

  it("a confident, complete extraction needs only the always-checked items", () => {
    expect(checkKeys(okReview(villa()))).toEqual(["tenancy:0"]);
  });
});

describe("buildReview: empty sections", () => {
  it("갑구 read in full with no issues -> 해당 없음, flagged for checking", () => {
    const r = okReview({ ...villa(), titleIssues: [] });
    expect(r.titleIssues.value).toEqual([]);
    expect(r.titleIssues.noIssues).toBe(true);
    expect(r.titleIssues.needsCheck).toBe(true);
  });

  it("갑구 not read in full -> unknown, never 해당 없음", () => {
    const r = okReview({ ...villa(), titleIssues: [], sections: { gapgu: "incomplete", eulgu: "complete" } });
    expect(r.titleIssues.value).toBeNull();
    expect(r.titleIssues.noIssues).toBe(false);
    expect(r.titleIssues.needsCheck).toBe(true);
  });

  it.each(["complete", "absent"] as const)("을구 %s with no 근저당 -> total 0, flagged", (eulgu) => {
    const r = okReview({ ...villa(), mortgages: [], sections: { gapgu: "complete", eulgu } });
    expect(r.mortgageTotal.value).toBe(0);
    expect(r.mortgageTotal.needsCheck).toBe(true);
  });

  it("을구 not read in full -> total unknown", () => {
    const r = okReview({ ...villa(), sections: { gapgu: "complete", eulgu: "incomplete" } });
    expect(r.mortgageTotal.value).toBeNull();
    expect(r.mortgageTotal.needsCheck).toBe(true);
  });
});

describe("buildReview: 확인 필요", () => {
  it("flags a value the AI marked uncertain, with its note", () => {
    const raw = villa();
    raw.exclusiveArea = { ...raw.exclusiveArea, confidence: "uncertain", note: "숫자가 흐림" };
    const r = okReview(raw);
    expect(r.area.needsCheck).toBe(true);
    expect(r.area.reasons.join(" ")).toContain("숫자가 흐림");
  });

  it("flags a value missing from the document and leaves it empty", () => {
    const r = okReview({ ...villa(), exclusiveArea: field(null) });
    expect(r.area.value).toBeNull();
    expect(r.area.needsCheck).toBe(true);
  });

  it("flags an unreadable amount and withholds the total", () => {
    const raw = villa();
    raw.mortgages[1] = { ...raw.mortgages[1], amount: "금5?,345,000원" };
    const r = okReview(raw);
    expect(r.mortgages[1]).toMatchObject({ finalManwon: null, needsCheck: true });
    expect(r.mortgageTotal.value).toBeNull();
  });

  it("flags an unreadable 접수일", () => {
    const raw = villa();
    raw.ownershipTransfer = { ...raw.ownershipTransfer, receiptDate: "2020년2월" };
    const r = okReview(raw);
    expect(r.ownershipTransfer.value).toBeNull();
    expect(r.ownershipTransfer.needsCheck).toBe(true);
  });

  it("flags an address whose 시군구 is not in the list", () => {
    const r = okReview({ ...villa(), address: field("가상도 가상시 가상동 1") });
    expect(r.address.needsCheck).toBe(true);
  });

  it("flags 읍·면 addresses, since the 법정동 name for the lookup is not verified", () => {
    const r = okReview({ ...villa(), address: field("경기도 양평군 양평읍 양근리 99") });
    expect(r.address.needsCheck).toBe(true);
  });

  it("flags an unknown building usage", () => {
    const r = okReview({ ...villa(), buildingUsage: field("2층 근린생활시설") });
    expect(r.houseType.value).toBeNull();
    expect(r.houseType.needsCheck).toBe(true);
  });

  it("lists the keys of every flagged item", () => {
    const raw = villa();
    raw.owners = { ...raw.owners, confidence: "uncertain" };
    raw.mortgages[0] = { ...raw.mortgages[0], confidence: "uncertain" };
    expect(checkKeys(okReview(raw))).toEqual(["owners", "mortgage:0", "tenancy:0"]);
  });
});

describe("toFormPrefill", () => {
  it("maps the reviewed values onto the form and the market-price lookup", () => {
    const r: Review = buildReview(villa());
    if (r.status !== "ok") throw new Error("expected ok");
    expect(toFormPrefill(r)).toEqual({
      mortgageMaxTotal: 23235,
      titleIssues: ["가압류"],
      noTitleIssues: false,
      ownershipTransferDate: "2020-02-14",
      lookup: { type: "rowhouse", sido: "서울특별시", lawdCd: "11440", umdNm: "망원동", jibun: "9202", area: 59.87 },
    });
  });

  it("leaves unknown values empty", () => {
    const r = okReview({
      ...villa(),
      address: field(null),
      buildingUsage: field(null),
      exclusiveArea: field(null),
      titleIssues: [],
      sections: { gapgu: "incomplete", eulgu: "incomplete" },
    });
    expect(toFormPrefill(r)).toEqual({
      mortgageMaxTotal: null,
      titleIssues: [],
      noTitleIssues: false,
      ownershipTransferDate: "2020-02-14",
      lookup: { type: null, sido: null, lawdCd: null, umdNm: null, jibun: null, area: null },
    });
  });
});

describe("checkUpload", () => {
  const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]; // %PDF-1
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const JPG = [0xff, 0xd8, 0xff, 0xe0];
  const HEIC = [0, 0, 0, 0x18, ...[..."ftypheic"].map((c) => c.charCodeAt(0))];
  const file = (head: number[], size = 100) => {
    const bytes = new Uint8Array(size);
    bytes.set(head);
    return { name: "x", bytes };
  };

  it("detects the type from the file contents, not the name", () => {
    const r = checkUpload([file(PNG), file(JPG)]);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.files.map((f) => f.mediaType)).toEqual(["image/png", "image/jpeg"]);
  });

  it("accepts a single PDF", () => {
    const r = checkUpload([file(PDF)]);
    expect(r.ok && r.files[0].mediaType).toBe("application/pdf");
  });

  it.each([
    ["no file", [], "골라"],
    ["HEIC photo", [file(HEIC)], "HEIC"],
    ["unknown type", [file([0x50, 0x4b, 0x03, 0x04])], "PDF, JPG, PNG"],
    ["PDF with a photo", [file(PDF), file(PNG)], "PDF는 한 번에 하나"],
    ["two PDFs", [file(PDF), file(PDF)], "PDF는 한 번에 하나"],
    ["too many photos", Array.from({ length: 11 }, () => file(PNG)), "10장"],
    ["too large in total", [file(PNG, 3_000_000), file(PNG, 1_300_000)], "너무 커요"],
  ])("rejects %s", (_label, files, text) => {
    const r = checkUpload(files);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(text);
  });
});
