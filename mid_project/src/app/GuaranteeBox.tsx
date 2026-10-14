import type { EngineResult } from "@/rules/engine";
import styles from "./RiskForm.module.css";

// Rule 6 is a warning next to the grade, not part of it, so it gets its own box.
export default function GuaranteeBox({ guarantee }: { guarantee: EngineResult["guarantee"] }) {
  const { result, reasons, needs, housePrice, notes, source } = guarantee;
  const low = result === "가입 가능성 낮음";
  return (
    <section
      className={low ? `${styles.guarantee} ${styles.guaranteeLow}` : styles.guarantee}
      aria-labelledby="guaranteeTitle"
    >
      <h3 id="guaranteeTitle" className={styles.guaranteeTitle}>
        보증보험(HUG 전세보증금반환보증) 가입 가능성
        <span className={styles.hint}> · 위 등급과 별개예요</span>
      </h3>

      {low && <p className={styles.guaranteeVerdict}>⚠ 가입 가능성 낮음</p>}
      {result === "기준 안에 있음" && (
        <p className={styles.guaranteeVerdict}>기준을 넘지 않았어요 (가입을 보장하지는 않아요)</p>
      )}
      {reasons.length > 0 && (
        <ul>{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
      {needs.length > 0 && (
        <p className={low ? styles.hint : styles.guaranteeVerdict}>
          {low ? "다른 조건도 보려면" : "판단하려면"} 이 값이 필요해요: {needs.join(", ")}
        </p>
      )}
      {housePrice !== null && (
        <p className={styles.hint}>계산에 쓴 주택가격: {housePrice.toLocaleString("ko-KR")}만원</p>
      )}
      {notes.map((n) => <p key={n} className={styles.hint}>{n}</p>)}
      <p className={styles.hint}>
        알려진 한계: 선순위채권은 근저당 채권최고액만 넣어 계산했어요. HUG는 전세권·임차보증금도 포함해요.
        공시가격은 직접 입력한 값을 써요.
      </p>
      <p className={styles.source}>
        기준: {source.source} (기준일 {source.basisDate}) ·{" "}
        <a href={source.url} target="_blank" rel="noreferrer">출처 보기</a>
      </p>
    </section>
  );
}
