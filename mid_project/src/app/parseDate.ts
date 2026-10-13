// Reads a date typed the way it appears on the 등기부 (e.g. "2024년5월12일") into YYYY-MM-DD.
// Only full dates (year, month, day) are accepted; anything else is "invalid".

export type ParsedDate = { kind: "ok"; iso: string } | { kind: "empty" } | { kind: "invalid" };

const PATTERNS = [
  /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일?$/, // 2024년 5월 12일
  /^(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*\.?$/, // 2024.5.12, 2024-05-12, 2024/5/12
  /^(\d{4})(\d{2})(\d{2})$/, // 20240512
];

export function parseKoreanDate(input: string): ParsedDate {
  const s = input.trim();
  if (s === "") return { kind: "empty" };
  for (const re of PATTERNS) {
    const m = re.exec(s);
    if (!m) continue;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (mo < 1 || mo > 12 || d < 1 || d > lastDay) return { kind: "invalid" };
    return { kind: "ok", iso: `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
  }
  return { kind: "invalid" };
}

// "2024-05-02" -> "2024년 5월 2일"
export function formatKoreanDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}
