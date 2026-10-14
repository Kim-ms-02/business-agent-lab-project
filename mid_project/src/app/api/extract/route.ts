// POST /api/extract: reads an uploaded 등기부 (doc=registry, default) or 계약서 (doc=contract)
// with Claude on the server and returns review data.
// The API key stays on the server. The uploaded file is kept in memory for this request only:
// it is not written to disk, cached, or logged.
import {
  checkContractKeys,
  checkKeys,
  checkUpload,
  extractContract,
  extractRegistry,
  ExtractError,
  toContractPrefill,
  toFormPrefill,
} from "@/agent/extract";

// Reading a multi-page PDF can take a while.
export const maxDuration = 120;

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest("요청 형식이 올바르지 않습니다.");
  }

  const uploads = await Promise.all(
    form
      .getAll("files")
      .filter((v): v is File => v instanceof File)
      .map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
  const checked = checkUpload(uploads);
  if (!checked.ok) return badRequest(checked.error);

  const doc = form.get("doc") ?? "registry";
  if (doc !== "registry" && doc !== "contract") return badRequest("서류 종류가 올바르지 않습니다.");

  try {
    if (doc === "contract") {
      const { review, usage } = await extractContract(checked.files);
      logUsage(doc, usage);
      if (review.status !== "ok") return Response.json({ review });
      return Response.json({ review, checkKeys: checkContractKeys(review), prefill: toContractPrefill(review) });
    }
    const { review, usage } = await extractRegistry(checked.files);
    logUsage(doc, usage);
    if (review.status !== "ok") return Response.json({ review });
    return Response.json({ review, checkKeys: checkKeys(review), prefill: toFormPrefill(review) });
  } catch (e) {
    const message = e instanceof ExtractError ? e.message : "서류를 읽지 못했어요. 잠시 후 다시 시도해 주세요.";
    return Response.json({ error: message }, { status: 502 });
  }
}

// Token counts only (no document content), to keep an eye on cost.
function logUsage(doc: string, usage: { inputTokens: number; outputTokens: number }) {
  console.info(`[extract] doc=${doc} input_tokens=${usage.inputTokens} output_tokens=${usage.outputTokens}`);
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}
