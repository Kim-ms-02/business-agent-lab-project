"use client";

import { useState, type FormEvent } from "react";
import {
  evaluate,
  TITLE_ISSUES,
  type EngineResult,
  type Field,
  type Grade,
  type TitleIssue,
} from "@/rules/engine";
import MarketPriceLookup from "./MarketPriceLookup";
import { formatKoreanDate, parseKoreanDate } from "./parseDate";
import styles from "./RiskForm.module.css";

const FIELD_LABELS: Record<Field, string> = {
  deposit: "보증금",
  marketPrice: "매매시세",
  mortgageMaxTotal: "근저당 채권최고액 합계",
  titleIssues: "갑구 위험 기재",
  ownershipTransferDate: "소유권 이전일",
};

const GRADE_CLASS: Record<Grade, string> = {
  안전: styles.safe,
  주의: styles.caution,
  위험: styles.danger,
};

export default function RiskForm() {
  const [deposit, setDeposit] = useState("");
  const [marketPrice, setMarketPrice] = useState("");
  const [marketPriceFromTrades, setMarketPriceFromTrades] = useState(false);
  const [mortgage, setMortgage] = useState("");
  const [issues, setIssues] = useState<TitleIssue[]>([]);
  const [noIssues, setNoIssues] = useState(false);
  const [transferDate, setTransferDate] = useState("");
  const [result, setResult] = useState<EngineResult | null>(null);
  const parsedTransferDate = parseKoreanDate(transferDate);

  function toggleIssue(item: TitleIssue) {
    setIssues((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(
      evaluate(
        {
          deposit: toAmount(deposit),
          marketPrice: toAmount(marketPrice),
          mortgageMaxTotal: toAmount(mortgage),
          titleIssues: TITLE_ISSUES.filter((i) => issues.includes(i)),
          noTitleIssues: noIssues,
          // Unreadable dates are not passed on, so the engine reports the date as missing.
          ownershipTransferDate: parsedTransferDate.kind === "ok" ? parsedTransferDate.iso : undefined,
        },
        localToday(),
      ),
    );
  }

  return (
    <>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <AmountField id="deposit" label="보증금" value={deposit} onChange={setDeposit}
          hint="계약서에 적힌 전세 보증금" />
        <MarketPriceLookup
          onEstimate={(manwon) => {
            if (manwon !== null) {
              setMarketPrice(String(manwon));
              setMarketPriceFromTrades(true);
            } else if (marketPriceFromTrades) {
              // Clear an estimate left over from a previous lookup; keep values the user typed.
              setMarketPrice("");
              setMarketPriceFromTrades(false);
            }
          }}
        />
        <AmountField id="marketPrice" label="매매시세" value={marketPrice}
          onChange={(v) => {
            setMarketPrice(v);
            setMarketPriceFromTrades(false);
          }}
          badge={marketPriceFromTrades ? "실거래 추정값" : undefined}
          hint="이 집을 지금 판다면 받을 수 있는 가격. 위에서 실거래가로 찾거나 직접 입력하세요." />
        <AmountField id="mortgage" label="근저당 채권최고액 합계" value={mortgage} onChange={setMortgage}
          hint="등기부 을구에 근저당이 없을 때만 0을 입력하세요. 잘 모르겠으면 비워 두세요." />

        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>갑구 위험 기재</legend>
          <p className={styles.hint}>등기부 갑구(소유권에 관한 사항)에 아래 기록이 있으면 모두 고르세요.</p>
          <div className={styles.checks}>
            {TITLE_ISSUES.map((item) => (
              <label key={item} className={styles.check}>
                <input type="checkbox" checked={issues.includes(item)} onChange={() => toggleIssue(item)} />
                {item}
              </label>
            ))}
            <label className={styles.check}>
              <input type="checkbox" checked={noIssues} onChange={(e) => setNoIssues(e.target.checked)} />
              해당 없음
            </label>
          </div>
        </fieldset>

        <div className={styles.field}>
          <label htmlFor="transferDate" className={styles.label}>소유권 이전일</label>
          <p className={styles.hint}>
            등기부 갑구에서 가장 최근 &lsquo;소유권이전&rsquo;의 접수일을 적힌 그대로 넣어 주세요. (예: 2024년 5월 12일)
          </p>
          <input id="transferDate" type="text" inputMode="text" autoComplete="off" className={styles.input}
            placeholder="2024년 5월 12일" value={transferDate} aria-describedby="transferDateReadback"
            onChange={(e) => setTransferDate(e.target.value)} />
          <p id="transferDateReadback" aria-live="polite"
            className={parsedTransferDate.kind === "invalid" ? styles.errorText : styles.hint}>
            {parsedTransferDate.kind === "ok" && `${formatKoreanDate(parsedTransferDate.iso)}로 읽었어요 ✓`}
            {parsedTransferDate.kind === "invalid" && "날짜를 읽지 못했어요. 예: 2024년 5월 12일"}
          </p>
        </div>

        <button type="submit" className={styles.submit}>위험 확인하기</button>
      </form>

      {result && <Result result={result} />}
    </>
  );
}

function AmountField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint: string;
  badge?: string;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={props.id} className={styles.label}>
        {props.label} (만원)
        {props.badge && <span className={styles.badge}>{props.badge}</span>}
      </label>
      <p className={styles.hint}>{props.hint}</p>
      <input id={props.id} type="number" inputMode="numeric" min={0} step={1} className={styles.input}
        value={props.value} onChange={(e) => props.onChange(e.target.value)} />
    </div>
  );
}

function Result({ result }: { result: EngineResult }) {
  const { grade, hits, missing, errors, metrics } = result;
  return (
    <section className={styles.result} aria-live="polite">
      <h2 className={styles.resultTitle}>확인 결과</h2>

      {grade ? (
        <p className={`${styles.grade} ${GRADE_CLASS[grade]}`}>등급: {grade}</p>
      ) : (
        <p className={styles.noGrade}>아직 등급을 낼 수 없어요. 아래 값을 채우거나 고쳐 주세요.</p>
      )}

      {missing.length > 0 && (
        <div className={styles.block}>
          <h3>빠진 값</h3>
          <ul>{missing.map((f) => <li key={f}>{FIELD_LABELS[f]}</li>)}</ul>
        </div>
      )}

      {errors.length > 0 && (
        <div className={styles.block}>
          <h3>잘못 입력된 값</h3>
          <ul>{errors.map((e) => <li key={e.field}>{FIELD_LABELS[e.field]}: {e.message}</li>)}</ul>
        </div>
      )}

      {(metrics.jeonseRatio !== undefined || metrics.seniorBurdenRatio !== undefined) && (
        <div className={styles.block}>
          <h3>계산한 값</h3>
          <ul>
            {metrics.jeonseRatio !== undefined && <li>전세가율(보증금 ÷ 매매시세): {pct(metrics.jeonseRatio)}</li>}
            {metrics.seniorBurdenRatio !== undefined && (
              <li>선순위 부담률((근저당 + 보증금) ÷ 매매시세): {pct(metrics.seniorBurdenRatio)}</li>
            )}
          </ul>
        </div>
      )}

      <div className={styles.block}>
        <h3>걸린 규칙</h3>
        {hits.length === 0 ? (
          <p>걸린 규칙이 없습니다.</p>
        ) : (
          <ul className={styles.hits}>
            {hits.map((h) => (
              <li key={h.ruleId} className={styles.hit}>
                <span className={`${styles.tag} ${GRADE_CLASS[h.grade]}`}>{h.grade}</span>
                <p>{h.reason}</p>
                <p className={styles.source}>
                  기준: {h.source.source} (기준일 {h.source.basisDate})
                  {h.source.url.startsWith("http") && (
                    <> · <a href={h.source.url} target="_blank" rel="noreferrer">출처 보기</a></>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className={styles.disclaimer}>
        이 결과는 법률 자문이 아닙니다. 계약 전에 확인을 돕는 참고 자료이며, 중요한 결정은 공인중개사·법무사 등
        전문가와 상의하세요.
      </p>
    </section>
  );
}

function toAmount(s: string): number | undefined {
  return s.trim() === "" ? undefined : Number(s);
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pct(ratio: number): string {
  return `${(Math.round(ratio * 1000) / 10).toFixed(1)}%`;
}
