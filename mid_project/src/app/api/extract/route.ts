// POST /api/extract: reads an uploaded 등기부 with Claude on the server and returns review data.
// The API key stays on the server. The uploaded file is kept in memory for this request only:
// it is not written to disk, cached, or logged.
import { checkKeys, checkUpload, extractRegistry, ExtractError, toFormPrefill } from "@/agent/extract";

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

  try {
    const { review, usage } = await extractRegistry(checked.files);
    // Token counts only (no document content), to keep an eye on cost.
    console.info(`[extract] input_tokens=${usage.inputTokens} output_tokens=${usage.outputTokens}`);
    if (review.status !== "ok") return Response.json({ review });
    return Response.json({ review, checkKeys: checkKeys(review), prefill: toFormPrefill(review) });
  } catch (e) {
    const message = e instanceof ExtractError ? e.message : "서류를 읽지 못했어요. 잠시 후 다시 시도해 주세요.";
    return Response.json({ error: message }, { status: 502 });
  }
}

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}
