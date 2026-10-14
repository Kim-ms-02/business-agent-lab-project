import type { ReactNode } from "react";
import type { Evidence } from "@/agent/extract";
import styles from "./RiskForm.module.css";

// One reviewed value: the value, why it needs a look, the source text, and the "확인했어요" box.
export function Row(props: {
  label: string;
  children: ReactNode;
  needsCheck: boolean;
  reasons: string[];
  evidence: Evidence[];
  checked: boolean;
  onCheck: (on: boolean) => void;
  confirmLabel?: string;
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
          {props.confirmLabel ?? "등기부와 비교해서 확인했어요"}
        </label>
      )}
    </div>
  );
}

// 180000000 -> "1억 8,000만원", 52345000 -> "5,234만 5,000원"
export function wonText(won: number): string {
  const eok = Math.floor(won / 100_000_000);
  const man = Math.floor((won % 100_000_000) / 10_000);
  const rest = won % 10_000;
  const parts = [eok > 0 && `${eok}억`, man > 0 && `${man.toLocaleString("ko-KR")}만`, rest > 0 && rest.toLocaleString("ko-KR")];
  const text = parts.filter(Boolean).join(" ");
  return text === "" ? "0원" : `${text}원`;
}
