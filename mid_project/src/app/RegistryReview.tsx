"use client";

import { useState, type ReactNode } from "react";
import type { Evidence, ReviewOk, TenancyKind } from "@/agent/extract";
import { HOUSE_TYPE_LABELS } from "@/data/marketPrice";
import { formatKoreanDate } from "./parseDate";
import styles from "./RiskForm.module.css";

// Fixed wording (not written by the AI). The 조문 text itself could not be opened on
// 국가법령정보센터 on 2026-10-13, so the source is marked as unverified.
const TENANCY_NOTES: Record<TenancyKind, { text: string; source: string | null }> = {
  임차권: {
    text:
      "임차권등기는 예전 세입자가 계약이 끝났는데도 보증금을 돌려받지 못했을 때 법원 명령으로 하는 등기예요. " +
      "집주인이 보증금을 제때 돌려주지 못한 적이 있다는 신호일 수 있어요.",
    source: "주택임대차보호법 제3조의3(임차권등기명령) · 조문 원문 미확인",
  },
  전세권: {
    text: "말소되지 않은 전세권이 있어요. 지금도 살고 있는 세입자가 있는지, 계약 전에 말소되는지 꼭 확인해 주세요.",
    source: null,
  },
};

export default function RegistryReview({
  review,
  checkKeys,
  onApply,
}: {
  review: ReviewOk;
  checkKeys: string[];
  onApply: () => void;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const remaining = checkKeys.filter((k) => !checked.includes(k)).length;

  const tick = (key: string) => (on: boolean) =>
    setChecked((prev) => (on ? [...prev, key] : prev.filter((k) => k !== key)));
  const rowProps = (key: string, item: { needsCheck: boolean; reasons: string[]; evidence: Evidence[] }) => ({
    needsCheck: checkKeys.includes(key) && item.needsCheck,
    reasons: item.reasons,
    evidence: item.evidence,
    checked: checked.includes(key),
    onCheck: tick(key),
  });

  const { owners, address, houseType, area, ownershipTransfer, titleIssues, mortgages, mortgageTotal, tenancies, cancelled } =
    review;

  return (
    <div className={styles.review}>
      <h3 className={styles.subTitle}>읽어 온 값 확인</h3>
      <p className={styles.hint}>
        값마다 등기부의 원래 문장을 함께 보여 드려요. <strong>⚠ 확인 필요</strong> 표시는 AI가 자신 없거나 꼭 봐야 하는
        항목이에요. 등기부와 맞는지 보고 &lsquo;확인했어요&rsquo;를 눌러 주세요.
      </p>

      <Row label="소유자" {...rowProps("owners", owners)}>
        {owners.value?.map((o) => `${o.name} (${o.role}${o.share ? `, 지분 ${o.share}` : ""})`).join(", ") ?? "찾지 못함"}
      </Row>
      <Row label="주소 (지번)" {...rowProps("address", address)}>
        {address.value ? (
          <>
            {address.value.text}
            <span className={styles.hint}>
              {" "}→ 시세 조회 칸: {address.value.sido ?? "?"} {address.value.sigungu ?? "?"} / {address.value.umdNm ?? "?"} /{" "}
              {address.value.jibun ?? "?"}
            </span>
          </>
        ) : (
          "찾지 못함"
        )}
      </Row>
      <Row label="집 종류" {...rowProps("houseType", houseType)}>
        {houseType.value ? HOUSE_TYPE_LABELS[houseType.value] : "알 수 없음"}
      </Row>
      <Row label="전용면적" {...rowProps("area", area)}>
        {area.value !== null ? `${area.value}㎡` : "찾지 못함"}
      </Row>
      <Row label="소유권 이전일" {...rowProps("ownershipTransfer", ownershipTransfer)}>
        {ownershipTransfer.value ? (
          <>
            접수일 {formatKoreanDate(ownershipTransfer.value.receiptDate)}
            <span className={styles.hint}>
              {" "}(등기원인일 {ownershipTransfer.value.causeDate ? formatKoreanDate(ownershipTransfer.value.causeDate) : "?"}
              {ownershipTransfer.value.cause && ` ${ownershipTransfer.value.cause}`})
            </span>
          </>
        ) : (
          "찾지 못함"
        )}
      </Row>
      <Row label="갑구 위험 기재" {...rowProps("titleIssues", titleIssues)}>
        {titleIssues.value === null ? "알 수 없음" : titleIssues.value.length === 0 ? "없음 (해당 없음)" : titleIssues.value.join(", ")}
      </Row>

      {mortgages.map((m, i) => (
        <Row key={i} label={`근저당 ${i + 1}`} {...rowProps(`mortgage:${i}`, m)}>
          {m.finalManwon !== null ? `${m.finalManwon.toLocaleString("ko-KR")}만원` : "금액을 읽지 못함"}
          <span className={styles.hint}>
            {" "}(채권최고액 {m.changed && m.originalWon !== null && `${wonText(m.originalWon)} → 변경 `}
            {m.finalWon !== null ? wonText(m.finalWon) : "?"}
            {m.creditor && `, 채권자 ${m.creditor}`})
          </span>
        </Row>
      ))}
      <Row label="근저당 합계" {...rowProps("mortgageTotal", mortgageTotal)}>
        {mortgageTotal.value !== null ? `${mortgageTotal.value.toLocaleString("ko-KR")}만원` : "알 수 없음"}
        {mortgages.length > 0 && <span className={styles.hint}> (만원 미만은 올림)</span>}
      </Row>

      {tenancies.map((t, i) => (
        <Row key={i} label={t.kind === "임차권" ? "임차권등기" : "전세권"} {...rowProps(`tenancy:${i}`, t)} reasons={[]}>
          {t.amountWon !== null ? wonText(t.amountWon) : "금액 없음"}
          {t.holder && <span className={styles.hint}> ({t.kind === "임차권" ? "임차권자" : "전세권자"} {t.holder})</span>}
          <p className={styles.hint}>{TENANCY_NOTES[t.kind].text}</p>
          {TENANCY_NOTES[t.kind].source && <p className={styles.source}>출처: {TENANCY_NOTES[t.kind].source}</p>}
          <p className={styles.hint}>이 금액은 위험 판정 계산에는 넣지 않았어요.</p>
        </Row>
      ))}

      {cancelled.length > 0 && (
        <details className={styles.details}>
          <summary>말소되어 제외한 기재 {cancelled.length}건</summary>
          <ul>
            {cancelled.map((c, i) => (
              <li key={i}>
                {c.location && `${c.location} · `}
                {c.purpose}: <q>{c.quote}</q>
              </li>
            ))}
          </ul>
        </details>
      )}

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
          아래 칸에 채웠어요. 틀린 값은 아래 칸에서 바로 고쳐 주세요. 보증금과 매매시세는 직접 넣거나 시세 찾기를 눌러 주세요.
        </p>
      )}
    </div>
  );
}

function Row(props: {
  label: string;
  children: ReactNode;
  needsCheck: boolean;
  reasons: string[];
  evidence: Evidence[];
  checked: boolean;
  onCheck: (on: boolean) => void;
}) {
  return (
    <div className={props.needsCheck ? `${styles.reviewRow} ${styles.needsCheck}` : styles.reviewRow}>
      <div className={styles.reviewHead}>
        <span className={styles.label}>{props.label}</span>
        {props.needsCheck && <span className={styles.checkBadge}>⚠ 확인 필요</span>}
      </div>
      <div>{props.children}</div>
      {props.reasons.length > 0 && <p className={styles.hint}>{props.reasons.join(" ")}</p>}
      {props.evidence.length > 0 ? (
        <ul className={styles.evidence}>
          {props.evidence.map((e, i) => (
            <li key={i}>
              근거{e.location && ` (${e.location})`}: <q>{e.quote}</q>
            </li>
          ))}
        </ul>
      ) : null}
      {props.needsCheck && (
        <label className={styles.check}>
          <input type="checkbox" checked={props.checked} onChange={(e) => props.onCheck(e.target.checked)} />
          등기부와 비교해서 확인했어요
        </label>
      )}
    </div>
  );
}

// 180000000 -> "1억 8,000만원", 52345000 -> "5,234만 5,000원"
function wonText(won: number): string {
  const eok = Math.floor(won / 100_000_000);
  const man = Math.floor((won % 100_000_000) / 10_000);
  const rest = won % 10_000;
  const parts = [eok > 0 && `${eok}억`, man > 0 && `${man.toLocaleString("ko-KR")}만`, rest > 0 && rest.toLocaleString("ko-KR")];
  const text = parts.filter(Boolean).join(" ");
  return text === "" ? "0원" : `${text}원`;
}
