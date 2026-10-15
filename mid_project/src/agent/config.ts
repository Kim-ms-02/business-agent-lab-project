// Settings for the document-reading AI. Change the model here, nowhere else.

// Claude API model ID, checked against the Anthropic "Models overview" page
// (https://platform.claude.com/docs/en/about-claude/models/overview) on 2026-10-13.
export const EXTRACT_MODEL = "claude-sonnet-5-5";

// How hard the model thinks (low | medium | high | xhigh | max). "high" is this model's default.
// Lower it to cut cost once the fixtures show the answers stay correct.
export const EXTRACT_EFFORT = "high" as const;

// Upper bound on the answer (JSON + thinking). Thinking tokens are billed as output.
export const EXTRACT_MAX_TOKENS = 16000;

// Upload limits. Vercel rejects request bodies over 4.5MB, so we stop a little below that.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGES = 10;

// ---------- v0.5: explanation (RAG) ----------

// Separate from EXTRACT_MODEL so the two can change independently. Same ID, confirmed by a live call
// (response.model = "claude-sonnet-5-5") on 2026-10-15.
export const EXPLAIN_MODEL = "claude-sonnet-5-5";
export const EXPLAIN_EFFORT = "high" as const; // this model's default
export const EXPLAIN_MAX_TOKENS = 16000;

// A sentence without a source or with a number that is not in the result is rejected; the AI gets
// this many more tries, then the remaining bad sentences are dropped.
export const EXPLAIN_MAX_RETRIES = 2;

// BM25 over Korean character bigrams (standard defaults).
export const BM25 = { k1: 1.2, b: 0.75 } as const;

// How many chunks each rule's search passes on to the explanation.
export const SEARCH_TOP_K = 3;
