// Splits official documents into searchable chunks (v0.5). Used by scripts/build-chunks.mjs.
// Laws are cut per 조문, PDFs per 쪽, web guides without pages per 소제목 (h2/h3).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const UNITS = ["쪽", "조문", "소제목"];

/**
 * @typedef {{ locator: string, text: string }} Part
 * @typedef {{ id: string, file: string, title: string, org: string, url: string, checkedDate: string, unit: "쪽" | "조문" | "소제목" }} Source
 * @typedef {{ id: string, sourceId: string, title: string, org: string, url: string, checkedDate: string, locator: string, text: string }} Chunk
 */

// Share of characters that cannot be real text (U+FFFD, private use area, control characters).
// A PDF whose fonts lack a Unicode map comes out like this.
/** @param {string} text */
export function garbledRatio(text) {
  const chars = [...text.replace(/\s/g, "")];
  if (chars.length === 0) return 0;
  const bad = chars.filter((c) => /[�-\u0000-\u001F]/.test(c)).length;
  return bad / chars.length;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** @param {string} html @returns {string} */
export function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/dt|\/dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) =>
      e.startsWith("#x") ? String.fromCodePoint(parseInt(e.slice(2), 16))
      : e.startsWith("#") && e !== "#39" ? String.fromCodePoint(Number(e.slice(1)))
      : ENTITIES[e.toLowerCase()] ?? m)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

const ARTICLE = /^(제\d+조(?:의\d+)?)\s*\(([^)]*)\)/;

// 법령 text -> one part per 조문. Text before the first 조문 and everything from 부칙 on are dropped.
/** @param {string} text @returns {Part[]} */
export function splitByArticle(text) {
  const parts = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    if (/^부\s*칙/.test(line)) break;
    const m = ARTICLE.exec(line);
    if (m) {
      current = { locator: `${m[1]}(${m[2]})`, lines: [line] };
      parts.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return parts.map((p) => ({ locator: p.locator, text: p.lines.join("\n") }));
}

// Web guide (HTML) -> one part per h2/h3 section. The heading is kept as the first line.
/** @param {string} html @returns {Part[]} */
export function splitByHeading(html) {
  const pieces = html.split(/(?=<h[23]\b)/i);
  const parts = [];
  for (const piece of pieces) {
    const m = /^<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(piece);
    if (!m) continue;
    const heading = htmlToText(m[1]);
    const body = htmlToText(piece.slice(m[0].length));
    parts.push({ locator: heading, text: body ? `${heading}\n${body}` : heading });
  }
  return parts;
}

// PDF -> text of each page (page 1 first). Uses PDF.js; CMaps are needed for CJK fonts.
/** @param {string} path @returns {Promise<string[]>} */
export async function pdfPages(path) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pkg = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const task = getDocument({
    data: new Uint8Array(readFileSync(path)),
    cMapUrl: join(pkg, "cmaps") + "/",
    cMapPacked: true,
    standardFontDataUrl: join(pkg, "standard_fonts") + "/",
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const text = content.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("");
    pages.push(text.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n"));
  }
  await task.destroy();
  return pages;
}

const COLUMNS = { id: "id", 파일: "file", 문서명: "title", 기관: "org", 주소: "url", "확인한 날짜": "checkedDate", "나누는 단위": "unit" };

// SOURCES.md -> source entries. The table needs the columns listed in COLUMNS (any order).
/** @param {string} md @returns {Source[]} */
export function parseSourcesTable(md) {
  const rows = md
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"))
    .map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  if (rows.length < 2) throw new Error("SOURCES.md에 문서 표가 없습니다.");
  const header = rows[0];
  const missing = Object.keys(COLUMNS).filter((h) => !header.includes(h));
  if (missing.length > 0) throw new Error(`SOURCES.md 표에 열이 없습니다: ${missing.join(", ")}`);
  return rows
    .slice(1)
    .filter((cells) => !cells.every((c) => /^:?-+:?$/.test(c)))
    .map((cells) => {
      const entry = {};
      header.forEach((h, i) => {
        if (h in COLUMNS) entry[COLUMNS[h]] = cells[i] ?? "";
      });
      if (!UNITS.includes(entry.unit)) throw new Error(`${entry.id}: 나누는 단위는 ${UNITS.join("/")} 중 하나여야 합니다.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.checkedDate)) throw new Error(`${entry.id}: 확인한 날짜는 YYYY-MM-DD로 적어 주세요.`);
      return entry;
    });
}

// Parts -> chunks labelled with 문서명·위치·주소. Empty parts are skipped; ids stay unique.
/** @param {Source} source @param {Part[]} parts @returns {Chunk[]} */
export function toChunks(source, parts) {
  const seen = new Map();
  return parts
    .filter((p) => p.text.trim() !== "")
    .map((p) => {
      const base = `${source.id}#${p.locator.replace(/\(.*$/, "").trim()}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return {
        id: n === 1 ? base : `${base}-${n}`,
        sourceId: source.id,
        title: source.title,
        org: source.org,
        url: source.url,
        checkedDate: source.checkedDate,
        locator: p.locator,
        text: p.text.trim(),
      };
    });
}
