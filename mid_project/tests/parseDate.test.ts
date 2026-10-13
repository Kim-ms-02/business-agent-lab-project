import { describe, expect, it } from "vitest";
import { formatKoreanDate, parseKoreanDate } from "../src/app/parseDate";

describe("parseKoreanDate", () => {
  it.each([
    ["2024년 5월 12일", "2024-05-12"],
    ["2024년5월12일", "2024-05-12"], // 등기부 원문 표기
    ["2024 년 05 월 12 일", "2024-05-12"],
    ["2024년 5월 12", "2024-05-12"],
    ["2024.5.12", "2024-05-12"],
    ["2024. 05. 12.", "2024-05-12"],
    ["2024-05-12", "2024-05-12"],
    ["2024/5/12", "2024-05-12"],
    ["20240512", "2024-05-12"],
    ["  2024.05.12  ", "2024-05-12"],
  ])("%j -> %s", (input, iso) => {
    expect(parseKoreanDate(input)).toEqual({ kind: "ok", iso });
  });

  it.each(["", "   "])("blank %j -> empty", (input) => {
    expect(parseKoreanDate(input)).toEqual({ kind: "empty" });
  });

  it.each([
    "2024.5", // day missing
    "2024년 5월",
    "202405", // 6 digits
    "202005010", // 9 digits
    "2024-13-01",
    "2024-02-30",
    "2023-02-29", // not a leap year
    "24.5.12", // 2-digit year
    "5월 12일",
    "abc",
  ])("%j -> invalid", (input) => {
    expect(parseKoreanDate(input)).toEqual({ kind: "invalid" });
  });

  it("accepts 29 Feb in a leap year", () => {
    expect(parseKoreanDate("2024.2.29")).toEqual({ kind: "ok", iso: "2024-02-29" });
  });
});

describe("formatKoreanDate", () => {
  it("formats an ISO date for the read-back line", () => {
    expect(formatKoreanDate("2024-05-02")).toBe("2024년 5월 2일");
  });
});
