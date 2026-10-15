// Builds docs/sources/chunks.json from the official documents listed in docs/sources/SOURCES.md (v0.5).
// Usage: node scripts/build-chunks.mjs
// The original files stay local (.gitignore); only SOURCES.md and chunks.json are committed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import {
  garbledRatio,
  htmlToText,
  parseSourcesTable,
  pdfPages,
  splitByArticle,
  splitByHeading,
  toChunks,
} from "./chunking.mjs";

const DIR = resolve(import.meta.dirname, "../docs/sources");
// Above this share of broken characters a document is reported as garbled (한글 깨짐).
const GARBLED_LIMIT = 0.02;

const sources = parseSourcesTable(readFileSync(join(DIR, "SOURCES.md"), "utf8"));
const chunks = [];
const problems = [];

for (const source of sources) {
  const path = join(DIR, source.file);
  if (!existsSync(path)) {
    problems.push(`${source.id}: 파일이 없습니다 (${source.file})`);
    continue;
  }
  const ext = extname(source.file).toLowerCase();
  let parts;
  if (ext === ".pdf") {
    if (source.unit !== "쪽") problems.push(`${source.id}: PDF는 '쪽' 단위로 나눕니다 (표에는 ${source.unit})`);
    parts = (await pdfPages(path)).map((text, i) => ({ locator: `${i + 1}쪽`, text }));
  } else {
    const raw = readFileSync(path, "utf8");
    const isHtml = ext === ".html" || ext === ".htm";
    if (source.unit === "조문") parts = splitByArticle(isHtml ? htmlToText(raw) : raw);
    else if (source.unit === "소제목") parts = isHtml ? splitByHeading(raw) : [];
    else parts = [];
    if (parts.length === 0) problems.push(`${source.id}: '${source.unit}' 단위로 나눈 조각이 없습니다`);
  }

  const docChunks = toChunks(source, parts);
  const worst = Math.max(0, ...docChunks.map((c) => garbledRatio(c.text)));
  const empty = parts.length - docChunks.length;
  if (worst > GARBLED_LIMIT) problems.push(`${source.id}: 한글이 깨진 조각이 있습니다 (최대 ${(worst * 100).toFixed(1)}%)`);
  console.log(
    `${source.id}: ${docChunks.length}개 조각 (${source.unit})` +
      (empty > 0 ? `, 빈 ${source.unit} ${empty}개 제외` : "") +
      `, 깨진 글자 최대 ${(worst * 100).toFixed(1)}%`,
  );
  chunks.push(...docChunks);
}

const sourceList = sources.map(({ id, title, org, url, checkedDate, unit }) => ({ id, title, org, url, checkedDate, unit }));
writeFileSync(join(DIR, "chunks.json"), JSON.stringify({ sources: sourceList, chunks }, null, 1) + "\n");
console.log(`\n총 ${chunks.length}개 조각 → docs/sources/chunks.json`);
if (problems.length > 0) {
  console.log("\n확인이 필요한 문서:");
  for (const p of problems) console.log(`- ${p}`);
  process.exitCode = 1;
}
