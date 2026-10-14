"use client";

import { useState } from "react";
import type { ContractPrefill, ContractReviewOk, Evidence } from "@/agent/extract";
import DocumentUpload from "./DocumentUpload";
import { formatKoreanDate } from "./parseDate";
import { Row } from "./ReviewRow";
import styles from "./RiskForm.module.css";

export default function ContractUpload({ onApply }: { onApply: (prefill: ContractPrefill) => void }) {
  return (
    <DocumentUpload<ContractReviewOk, ContractPrefill>
      doc="contract"
      title="계약서 올려서 값 채우기"
      intro="주택임대차계약서 PDF 1개 또는 사진(JPG·PNG, 최대 10장)을 올리면 AI가 임대인·대리인·주소·보증금·계약일을 읽어 와요. 확인하신 뒤에만 아래 칸에 채우고, 등기부와 비교해요."
      fileLabel="계약서"
      renderReview={(r) => (
        <ContractReview review={r.review} checkKeys={r.checkKeys} onApply={() => onApply(r.prefill)} />
      )}
    />
  );
}

function ContractReview({
  review,
  checkKeys,
  onApply,
}: {
  review: ContractReviewOk;
  checkKeys: string[];
  onApply: () => void;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const remaining = checkKeys.filter((k) => !checked.includes(k)).length;

  const rowProps = (key: string, item: { needsCheck: boolean; reasons: string[]; evidence: Evidence[] }) => ({
    needsCheck: checkKeys.includes(key) && item.needsCheck,
    reasons: item.reasons,
    evidence: item.evidence,
    checked: checked.includes(key),
    onCheck: (on: boolean) => setChecked((prev) => (on ? [...prev, key] : prev.filter((k) => k !== key))),
    confirmLabel: "계약서와 비교해서 확인했어요",
  });
  const { landlords, agent, address, deposit, contractDate } = review;

  return (
    <div className={styles.review}>
      <h3 className={styles.subTitle}>읽어 온 값 확인</h3>
      <p className={styles.hint}>
        값마다 계약서의 원래 문장을 함께 보여 드려요. <strong>⚠ 확인 필요</strong> 항목은 계약서와 맞는지 보고
        &lsquo;확인했어요&rsquo;를 눌러 주세요.
      </p>

      <Row label="임대인" {...rowProps("landlords", landlords)}>
        {landlords.value?.join(", ") ?? "찾지 못함"}
      </Row>
      <Row label="대리인" {...rowProps("agent", agent)}>
        {agent.value?.present ? `있음 (${agent.value.name})` : "없음"}
      </Row>
      <Row label="주소 (소재지)" {...rowProps("address", address)}>
        {address.value ? (
          <>
            {address.value.text}
            <span className={styles.hint}>
              {" "}→ 지번 {address.value.jibun ?? "?"} / 동 {address.value.dong ?? "없음"} / 호수 {address.value.ho ?? "?"}
            </span>
          </>
        ) : (
          "찾지 못함"
        )}
      </Row>
      <Row label="보증금" {...rowProps("deposit", deposit)}>
        {deposit.value !== null ? `${deposit.value.toLocaleString("ko-KR")}만원` : "읽지 못함"}
      </Row>
      <Row label="계약일" {...rowProps("contractDate", contractDate)}>
        {contractDate.value ? formatKoreanDate(contractDate.value) : "찾지 못함"}
        <span className={styles.hint}> (보여 드리기만 하고 판정에는 쓰지 않아요)</span>
      </Row>

      {remaining > 0 && (
        <p className={styles.hint} aria-live="polite">
          ⚠ 확인 필요 항목 {checkKeys.length}개 중 {remaining}개를 아직 확인하지 않았어요.
        </p>
      )}
      <button
        type="button"
        className={styles.submit}
        disabled={remaining > 0}
        onClick={() => {
          onApply();
          setApplied(true);
        }}
      >
        확인하고 아래 칸에 채우기
      </button>
      {applied && (
        <p className={styles.hint} aria-live="polite">
          아래 칸에 채웠어요. 틀린 값은 아래 칸에서 바로 고쳐 주세요.
        </p>
      )}
    </div>
  );
}
