"use client";

import { useMemo, useState } from "react";
import type { FormPrefill } from "@/agent/extract";
import {
  HOUSE_TYPE_LABELS,
  type Estimate,
  type HouseType,
  type Trade,
} from "@/data/marketPrice";
import { REGIONS } from "@/data/regions";
import { MARKET_PRICE_METHOD } from "@/rules/config";
import styles from "./RiskForm.module.css";

const SIDOS = [...new Set(REGIONS.map((r) => r.sido))];

// onEstimate receives null when a lookup yields no estimate, so a stale estimate can be cleared.
// initial holds values read from an uploaded 등기부; the parent remounts this component (key) to apply new ones.
export default function MarketPriceLookup({
  onEstimate,
  initial,
}: {
  onEstimate: (manwon: number | null) => void;
  initial?: FormPrefill["lookup"];
}) {
  const [type, setType] = useState<HouseType>(initial?.type ?? "apartment");
  const [sido, setSido] = useState(initial?.sido ?? "");
  const [lawdCd, setLawdCd] = useState(initial?.lawdCd ?? "");
  const [umdNm, setUmdNm] = useState(initial?.umdNm ?? "");
  const [jibun, setJibun] = useState(initial?.jibun ?? "");
  const [area, setArea] = useState(initial?.area != null ? String(initial.area) : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Estimate | null>(null);

  const sigungus = useMemo(() => REGIONS.filter((r) => r.sido === sido), [sido]);

  async function lookup() {
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch("/api/market-price", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, lawdCd, umdNm, jibun, area: area.trim() === "" ? null : Number(area) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "시세를 찾지 못했습니다.");
        onEstimate(null);
        return;
      }
      setResult(data as Estimate);
      onEstimate(data.estimate);
    } catch {
      setError("시세를 찾지 못했습니다. 잠시 후 다시 시도해 주세요.");
      onEstimate(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <fieldset className={styles.lookup}>
      <legend className={styles.label}>실거래가로 매매시세 찾기</legend>
      <p className={styles.hint}>
        국토교통부 실거래가(실제로 팔린 가격)로 시세를 추정해 아래 매매시세 칸에 넣어 드려요. 직접 입력해도 됩니다.
      </p>
      {initial && (
        <p className={styles.badgeNote}>
          등기부에서 읽은 집 종류·주소·전용면적을 넣었어요. 맞는지 보고 아래 버튼을 눌러 주세요.
        </p>
      )}

      <div className={styles.checks} role="radiogroup" aria-label="집 종류">
        {(Object.keys(HOUSE_TYPE_LABELS) as HouseType[]).map((t) => (
          <label key={t} className={styles.check}>
            <input type="radio" name="houseType" checked={type === t} onChange={() => setType(t)} />
            {HOUSE_TYPE_LABELS[t]}
          </label>
        ))}
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="sido" className={styles.label}>시/도</label>
          <select id="sido" className={styles.input} value={sido}
            onChange={(e) => { setSido(e.target.value); setLawdCd(""); }}>
            <option value="">선택</option>
            {SIDOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="sigungu" className={styles.label}>시/군/구</label>
          <select id="sigungu" className={styles.input} value={lawdCd} disabled={!sido}
            onChange={(e) => setLawdCd(e.target.value)}>
            <option value="">선택</option>
            {sigungus.map((r) => <option key={r.code} value={r.code}>{r.sigungu}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="umdNm" className={styles.label}>법정동</label>
          <p className={styles.hint}>등기부 주소의 동 이름 (예: 잠실동). &lsquo;잠실2동&rsquo; 같은 행정동이 아니에요.</p>
          <input id="umdNm" className={styles.input} value={umdNm} onChange={(e) => setUmdNm(e.target.value)} />
        </div>
        <div className={styles.field}>
          <label htmlFor="jibun" className={styles.label}>지번</label>
          <p className={styles.hint}>도로명이 아닌 지번 (예: 35, 56-8)</p>
          <input id="jibun" className={styles.input} value={jibun} onChange={(e) => setJibun(e.target.value)} />
        </div>
      </div>

      <div className={styles.field}>
        <label htmlFor="area" className={styles.label}>전용면적 (㎡)</label>
        <p className={styles.hint}>
          계약서나 등기부에 적힌 전용면적(㎡)을 넣어 주세요. 공급면적이나 평수가 아니에요. (예: 84.95)
        </p>
        <input id="area" type="number" inputMode="decimal" min={0} step="0.01" className={styles.input}
          value={area} onChange={(e) => setArea(e.target.value)} />
      </div>

      <button type="button" className={styles.secondary} onClick={lookup} disabled={loading}>
        {loading ? "실거래가 찾는 중…" : "실거래가로 시세 찾기"}
      </button>

      {error && <p className={styles.errorText} role="alert">{error}</p>}
      {result && <EstimateView result={result} />}
    </fieldset>
  );
}

function EstimateView({ result }: { result: Estimate }) {
  const { estimate, used, excludedDirect, cancelledCount, period } = result;
  const usedNote = estimate !== null ? "계산에 사용" : "참고 (건수 부족)";
  const rows = [...used.map((t) => ({ t, note: usedNote })), ...excludedDirect.map((t) => ({ t, note: "직거래 · 계산 제외" }))];
  return (
    <div className={styles.estimate} aria-live="polite">
      {estimate !== null ? (
        <p className={styles.estimateValue}>
          추정 매매시세: {won(estimate)} <span className={styles.hint}>(매매시세 칸에 넣었어요)</span>
        </p>
      ) : (
        <p className={styles.estimateValue}>
          근거가 되는 거래가 {MARKET_PRICE_METHOD.minTrades}건보다 적어 시세를 정하지 않았어요. 매매시세를 직접 입력해 주세요.
        </p>
      )}
      <p className={styles.hint}>
        방법: {MARKET_PRICE_METHOD.source.source} (기간 {period.from} ~ {period.to}, 기준일 {MARKET_PRICE_METHOD.source.basisDate}).
        실제로 팔린 가격을 바탕으로 한 추정값이라 지금 시세와 다를 수 있어요.
        {cancelledCount > 0 && ` 취소된 거래 ${cancelledCount}건은 뺐어요.`}
      </p>

      <h3 className={styles.subTitle}>근거 거래 (중개거래 {used.length}건{excludedDirect.length > 0 && `, 직거래 ${excludedDirect.length}건 제외`})</h3>
      {rows.length === 0 ? (
        <p>조건에 맞는 거래가 없어요. 법정동·지번·전용면적을 다시 확인해 주세요.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>계약일</th><th>거래금액</th><th>전용면적</th><th>층</th><th>단지명</th><th>비고</th></tr>
            </thead>
            <tbody>
              {rows.map(({ t, note }) => <TradeRow key={t.id} t={t} note={note} />)}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.source}>출처: 국토교통부 실거래가 공개시스템 (공공데이터포털 오픈API)</p>
    </div>
  );
}

function TradeRow({ t, note }: { t: Trade; note: string }) {
  return (
    <tr>
      <td>{t.date}</td>
      <td>{won(t.amount)}</td>
      <td>{t.area}㎡</td>
      <td>{t.floor ?? "-"}</td>
      <td>{t.name}</td>
      <td>{note}</td>
    </tr>
  );
}

// 316000 (만원) -> "31억 6,000만원"
function won(manwon: number): string {
  const eok = Math.floor(manwon / 10000);
  const rest = manwon % 10000;
  if (eok === 0) return `${rest.toLocaleString("ko-KR")}만원`;
  return rest === 0 ? `${eok}억원` : `${eok}억 ${rest.toLocaleString("ko-KR")}만원`;
}
