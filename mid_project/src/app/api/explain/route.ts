// POST /api/explain: easy explanations and questions with sources for a risk result (v0.5).
// The server runs the rules again from the form values and sends the AI only the grade, the rule facts
// (no names, 동·호수 or region) and the official chunks. The API key stays on the server.
// Neither the request to the AI nor its answer is logged; only token counts and attempts are.
import { askClaude, ExplainError, explainReport, parseExplainBody } from "@/agent/explain";

// Up to 1 + EXPLAIN_MAX_RETRIES calls of at most EXPLAIN_CALL_TIMEOUT_MS each.
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const parsed = parseExplainBody(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const report = await explainReport(parsed.value, askClaude);
    console.info(
      `[explain] attempts=${report.attempts} dropped=${report.dropped} input_tokens=${report.usage.inputTokens} output_tokens=${report.usage.outputTokens}`,
    );
    return Response.json({ topics: report.topics, glossary: report.glossary, dropped: report.dropped });
  } catch (e) {
    const err = e instanceof ExplainError ? e : new ExplainError("failed");
    return Response.json({ error: err.message }, { status: err.kind === "timeout" ? 504 : 502 });
  }
}
