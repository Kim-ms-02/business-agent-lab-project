"use client";

import type { FormPrefill, ReviewOk } from "@/agent/extract";
import DocumentUpload from "./DocumentUpload";
import RegistryReview from "./RegistryReview";

export default function RegistryUpload({ onApply }: { onApply: (prefill: FormPrefill, review: ReviewOk) => void }) {
  return (
    <DocumentUpload<ReviewOk, FormPrefill>
      doc="registry"
      title="등기부등본 올려서 값 채우기"
      intro="등기사항전부증명서(집합건물) PDF 1개 또는 사진(JPG·PNG, 최대 10장)을 올리면 AI가 값을 읽어 와요. 읽은 값은 원래 문장과 함께 보여 드리고, 확인하신 뒤에만 아래 칸에 채워요."
      fileLabel="등기부"
      renderReview={(r) => (
        <RegistryReview review={r.review} checkKeys={r.checkKeys} onApply={() => onApply(r.prefill, r.review)} />
      )}
    />
  );
}
