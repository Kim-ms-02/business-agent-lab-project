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
