// Keyword search over the official-document chunks (docs/sources/chunks.json): BM25 on Korean character
// bigrams. Bigrams inside each word let "근저당" match "근저당이", "근저당을" without a morphological analyzer.
// Search results are only used to write explanations; they never change the risk grade.
import { BM25 } from "./config";

export type Chunk = {
  id: string; // e.g. "housing-lease-act#제3조의2"
  sourceId: string;
  title: string; // 문서명
  org: string; // 기관
  url: string;
  checkedDate: string; // YYYY-MM-DD
  locator: string; // 쪽 or 조문, e.g. "12쪽", "제3조의2(보증금의 회수)"
  text: string;
  pdfPages?: number[]; // PDF page order, kept when it differs from the printed page or a 조문 spans pages
};

export type Hit = { chunk: Chunk; score: number };

export type Index = {
  chunks: Chunk[];
  terms: Map<string, number>[]; // term frequency per chunk
  lengths: number[];
  avgLength: number;
  docFreq: Map<string, number>;
};

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[가-힣a-z0-9]+/g) ?? [];
  const tokens: string[] = [];
  for (const w of words) {
    const chars = [...w];
    if (chars.length === 1) tokens.push(w);
    for (let i = 0; i + 1 < chars.length; i++) tokens.push(chars[i] + chars[i + 1]);
  }
  return tokens;
}

export function buildIndex(chunks: Chunk[]): Index {
  const terms = chunks.map((c) => {
    const tf = new Map<string, number>();
    for (const t of tokenize(`${c.locator} ${c.text}`)) tf.set(t, (tf.get(t) ?? 0) + 1);
    return tf;
  });
  const lengths = terms.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
  const docFreq = new Map<string, number>();
  for (const tf of terms) for (const t of tf.keys()) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  const avgLength = lengths.length > 0 ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  return { chunks, terms, lengths, avgLength, docFreq };
}

// Top k chunks for the query, best first. Chunks sharing no term with the query are never returned.
export function search(index: Index, query: string, k: number): Hit[] {
  const queryTerms = [...new Set(tokenize(query))];
  const n = index.chunks.length;
  const { k1, b } = BM25;
  const scored: Hit[] = [];
  index.chunks.forEach((chunk, i) => {
    let score = 0;
    for (const t of queryTerms) {
      const tf = index.terms[i].get(t);
      if (!tf) continue;
      const df = index.docFreq.get(t) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const norm = 1 - b + b * (index.lengths[i] / (index.avgLength || 1));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * norm));
    }
    if (score > 0) scored.push({ chunk, score });
  });
  // Array.prototype.sort is stable, so equal scores keep the chunk order.
  return scored.sort((x, y) => y.score - x.score).slice(0, k);
}
