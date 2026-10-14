"use client";

import { useState, type ChangeEvent, type ReactNode } from "react";
import { MAX_UPLOAD_BYTES } from "@/agent/config";
import styles from "./RiskForm.module.css";

// Upload → /api/extract → review, shared by the 등기부 (v0.3) and the 계약서 (v0.4).
export type ExtractOk<R, P> = { review: R; checkKeys: string[]; prefill: P };
type ApiResult = { review: { status: string; message?: string }; checkKeys?: string[]; prefill?: unknown } | { error: string };

// Photos are shrunk in the browser so a few pages stay under the upload limit.
const MAX_IMAGE_SIDE = 2000;

export default function DocumentUpload<R, P>(props: {
  doc: "registry" | "contract";
  title: string;
  intro: string;
  fileLabel: string;
  renderReview: (result: ExtractOk<R, P>) => ReactNode;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractOk<R, P> | null>(null);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    setFiles(Array.from(e.target.files ?? []));
    setError(null);
    setNotice(null);
    setResult(null);
  }

  async function read() {
    setError(null);
    setNotice(null);
    setResult(null);
    setLoading(true);
    try {
      const prepared = await Promise.all(files.map(shrinkImage));
      const total = prepared.reduce((sum, f) => sum + f.size, 0);
      if (total > MAX_UPLOAD_BYTES) {
        setError(`파일이 너무 커요(최대 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB). PDF는 필요한 부분만, 사진은 장수를 줄여 올려 주세요.`);
        return;
      }
      const body = new FormData();
      body.append("doc", props.doc);
      prepared.forEach((f) => body.append("files", f, f.name));
      const res = await fetch("/api/extract", { method: "POST", body });
      const data = (await res.json()) as ApiResult;
      if ("error" in data) {
        setError(data.error);
      } else if (data.review.status !== "ok") {
        setNotice(data.review.message ?? "서류를 읽지 못했어요.");
      } else if (data.checkKeys && data.prefill) {
        setResult({ review: data.review as R, checkKeys: data.checkKeys, prefill: data.prefill as P });
      }
    } catch {
      setError("서류를 읽지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.lookup} aria-labelledby={`${props.doc}Title`}>
      <h2 id={`${props.doc}Title`} className={styles.label}>{props.title}</h2>
      <p className={styles.hint}>{props.intro}</p>
      <p className={styles.hint}>
        올린 서류는 이 서비스에 저장하지 않아요. 다만 읽기 위해 Anthropic(Claude)에 보내며, Anthropic은 받은 내용을
        정책에 따라 30일 안에 삭제해요(법적 의무 등 예외가 있어요).
      </p>

      <input type="file" accept="application/pdf,image/jpeg,image/png" multiple onChange={onPick}
        className={styles.input} aria-label={props.fileLabel} />
      <button type="button" className={styles.secondary} onClick={read} disabled={loading || files.length === 0}>
        {loading ? "AI가 서류를 읽는 중… (10초쯤 걸려요)" : `${props.fileLabel} 읽기`}
      </button>

      {error && <p className={styles.errorText} role="alert">{error}</p>}
      {notice && <p className={styles.warnBox} role="alert">{notice}</p>}
      {result && props.renderReview(result)}
    </section>
  );
}

async function shrinkImage(file: File): Promise<File> {
  if (file.type !== "image/jpeg" && file.type !== "image/png") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    // The server checks the file again and explains what is wrong.
    return file;
  }
}
