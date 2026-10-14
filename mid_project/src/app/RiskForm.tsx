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
import type { ContractPrefill, FormPrefill, ReviewOk } from "@/agent/extract";
import type { HouseType } from "@/data/marketPrice";
import ContractUpload from "./ContractUpload";
import GuaranteeBox from "./GuaranteeBox";
import MarketPriceLookup from "./MarketPriceLookup";
import RegistryUpload from "./RegistryUpload";
import { formatKoreanDate, parseKoreanDate } from "./parseDate";
import styles from "./RiskForm.module.css";

const FIELD_LABELS: Record<Field, string> = {
  deposit: "보증금",
  marketPrice: "매매시세",
  mortgageMaxTotal: "근저당 채권최고액 합계",
  titleIssues: "갑구 위험 기재",
  ownershipTransferDate: "소유권 이전일",
};

const REGISTRY_BADGE = "등기부에서 읽음";
const CONTRACT_BADGE = "계약서에서 읽음";
const REALTY_PRICE_URL = "https://www.realtyprice.kr";

type UnitText = { jibun: string; dong: string; ho: string };
const EMPTY_UNIT: UnitText = { jibun: "", dong: "", ho: "" };

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
  // Which fields still hold the value read from the 등기부 (cleared as soon as the user edits them).
  const [fromRegistry, setFromRegistry] = useState({ mortgage: false, issues: false, transferDate: false });
  const [lookupInitial, setLookupInitial] = useState<FormPrefill["lookup"] | undefined>(undefined);
  const [lookupKey, setLookupKey] = useState(0);
  // v0.4: contract vs 등기부, 보증보험
  const [houseType, setHouseType] = useState<HouseType>("apartment");
  const [lawdCd, setLawdCd] = useState("");
  const [landlords, setLandlords] = useState("");
  const [owners, setOwners] = useState("");
  const [isAgent, setIsAgent] = useState(false);
  const [contractUnit, setContractUnit] = useState<UnitText>(EMPTY_UNIT);
  const [registryUnit, setRegistryUnit] = useState<UnitText>(EMPTY_UNIT);
  const [contractDeposit, setContractDeposit] = useState<number | null>(null);
  const [contractDate, setContractDate] = useState<string | null>(null);
  const [publicPrice, setPublicPrice] = useState("");
  const [fromContract, setFromContract] = useState({ deposit: false, landlords: false, agent: false, unit: false });
  const [fromRegistryV4, setFromRegistryV4] = useState({ owners: false, unit: false });
  const parsedTransferDate = parseKoreanDate(transferDate);

  function toggleIssue(item: TitleIssue) {
    setIssues((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]));
    setFromRegistry((f) => ({ ...f, issues: false }));
  }

  // Runs only after the user has confirmed the values on the review screen.
  function applyRegistry(p: FormPrefill, review: ReviewOk) {
    setMortgage(p.mortgageMaxTotal === null ? "" : String(p.mortgageMaxTotal));
    setIssues(p.titleIssues);
    setNoIssues(p.noTitleIssues);
    setTransferDate(p.ownershipTransferDate ? formatKoreanDate(p.ownershipTransferDate) : "");
    setFromRegistry({
      mortgage: p.mortgageMaxTotal !== null,
      issues: p.titleIssues.length > 0 || p.noTitleIssues,
      transferDate: p.ownershipTransferDate !== null,
    });
    // New address: restart the lookup from the 등기부 values and drop an estimate for the old one.
    setLookupInitial(p.lookup);
    setLookupKey((k) => k + 1);
    setHouseType(p.lookup.type ?? "apartment");
    setLawdCd(p.lookup.lawdCd ?? "");
    const ownerNames = review.owners.value?.map((o) => o.name) ?? [];
    setOwners(ownerNames.join(", "));
    setRegistryUnit({
      jibun: p.lookup.jibun ?? "",
      dong: p.registryUnit?.dong ?? "",
      ho: p.registryUnit?.ho ?? "",
    });
    setFromRegistryV4({ owners: ownerNames.length > 0, unit: !!p.registryUnit });
    if (marketPriceFromTrades) {
      setMarketPrice("");
      setMarketPriceFromTrades(false);
    }
    setResult(null);
  }

  function applyContract(c: ContractPrefill) {
    setLandlords(c.landlordNames.join(", "));
    setIsAgent(c.isAgentContract);
    setContractUnit(c.contractUnit ? { jibun: c.contractUnit.jibun, dong: c.contractUnit.dong ?? "", ho: c.contractUnit.ho } : EMPTY_UNIT);
    setContractDeposit(c.contractDeposit);
    setContractDate(c.contractDate);
    if (c.contractDeposit !== null) setDeposit(String(c.contractDeposit));
    setFromContract({
      deposit: c.contractDeposit !== null,
      landlords: c.landlordNames.length > 0,
      agent: true,
      unit: c.contractUnit !== null,
    });
    setResult(null);
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
          landlordNames: splitNames(landlords),
          ownerNames: splitNames(owners),
          isAgentContract: isAgent,
          contractUnit: toUnit(contractUnit),
          registryUnit: toUnit(registryUnit),
          contractDeposit: contractDeposit ?? undefined,
          houseType,
          lawdCd: lawdCd || undefined,
          publicPrice: toAmount(publicPrice),
        },
        localToday(),
      ),
    );
  }

  return (
    <>
      <RegistryUpload onApply={applyRegistry} />
      <ContractUpload onApply={applyContract} />

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <AmountField id="deposit" label="보증금" value={deposit}
          onChange={(v) => {
            setDeposit(v);
            setFromContract((f) => ({ ...f, deposit: false }));
          }}
          badge={fromContract.deposit ? CONTRACT_BADGE : undefined}
          hint={contractDeposit !== null
            ? `계약서에 적힌 전세 보증금 (계약서: ${contractDeposit.toLocaleString("ko-KR")}만원${contractDate ? `, 계약일 ${formatKoreanDate(contractDate)}` : ""})`
            : "계약서에 적힌 전세 보증금"} />
        <MarketPriceLookup
          key={lookupKey}
          initial={lookupInitial}
          onSelect={(sel) => {
            setHouseType(sel.type);
            setLawdCd(sel.lawdCd);
          }}
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
        <AmountField id="mortgage" label="근저당 채권최고액 합계" value={mortgage}
          onChange={(v) => {
            setMortgage(v);
            setFromRegistry((f) => ({ ...f, mortgage: false }));
          }}
          badge={fromRegistry.mortgage ? REGISTRY_BADGE : undefined}
          hint="등기부 을구에 근저당이 없을 때만 0을 입력하세요. 잘 모르겠으면 비워 두세요." />

        <fieldset className={styles.fieldset}>
          <legend className={styles.label}>
            갑구 위험 기재
            {fromRegistry.issues && <span className={styles.badge}>{REGISTRY_BADGE}</span>}
          </legend>
          <p className={styles.hint}>등기부 갑구(소유권에 관한 사항)에 아래 기록이 있으면 모두 고르세요.</p>
          <div className={styles.checks}>
            {TITLE_ISSUES.map((item) => (
              <label key={item} className={styles.check}>
                <input type="checkbox" checked={issues.includes(item)} onChange={() => toggleIssue(item)} />
                {item}
              </label>
            ))}
            <label className={styles.check}>
              <input type="checkbox" checked={noIssues}
                onChange={(e) => {
                  setNoIssues(e.target.checked);
                  setFromRegistry((f) => ({ ...f, issues: false }));
                }} />
              해당 없음
            </label>
          </div>
        </fieldset>

        <div className={styles.field}>
          <label htmlFor="transferDate" className={styles.label}>
            소유권 이전일
            {fromRegistry.transferDate && <span className={styles.badge}>{REGISTRY_BADGE}</span>}
          </label>
          <p className={styles.hint}>
            등기부 갑구에서 가장 최근 &lsquo;소유권이전&rsquo;의 접수일을 적힌 그대로 넣어 주세요. (예: 2024년 5월 12일)
          </p>
          <input id="transferDate" type="text" inputMode="text" autoComplete="off" className={styles.input}
            placeholder="2024년 5월 12일" value={transferDate} aria-describedby="transferDateReadback"
            onChange={(e) => {
              setTransferDate(e.target.value);
              setFromRegistry((f) => ({ ...f, transferDate: false }));
            }} />
          <p id="transferDateReadback" aria-live="polite"
            className={parsedTransferDate.kind === "invalid" ? styles.errorText : styles.hint}>
            {parsedTransferDate.kind === "ok" && `${formatKoreanDate(parsedTransferDate.iso)}로 읽었어요 ✓`}
            {parsedTransferDate.kind === "invalid" && "날짜를 읽지 못했어요. 예: 2024년 5월 12일"}
          </p>
        </div>

        <fieldset className={styles.lookup}>
          <legend className={styles.label}>계약서·등기부 대조와 보증보험</legend>
          <p className={styles.hint}>
            계약하는 사람이 등기부의 집주인인지, 계약서 주소가 등기부와 같은지 비교해요. 위에서 계약서와 등기부를 올리면 채워져요.
          </p>

          <div className={styles.field}>
            <label htmlFor="landlords" className={styles.label}>
              임대인 이름 (계약서)
              {fromContract.landlords && <span className={styles.badge}>{CONTRACT_BADGE}</span>}
            </label>
            <p className={styles.hint}>여러 명이면 쉼표(,)로 나눠 주세요.</p>
            <input id="landlords" className={styles.input} value={landlords}
              onChange={(e) => {
                setLandlords(e.target.value);
                setFromContract((f) => ({ ...f, landlords: false }));
              }} />
          </div>
          <label className={styles.check}>
            <input type="checkbox" checked={isAgent}
              onChange={(e) => {
                setIsAgent(e.target.checked);
                setFromContract((f) => ({ ...f, agent: false }));
              }} />
            대리인이 계약해요 (계약서 대리인 칸에 이름이 있음)
            {fromContract.agent && <span className={styles.badge}>{CONTRACT_BADGE}</span>}
          </label>

          <div className={styles.field}>
            <label htmlFor="owners" className={styles.label}>
              등기부 소유자
              {fromRegistryV4.owners && <span className={styles.badge}>{REGISTRY_BADGE}</span>}
            </label>
            <p className={styles.hint}>공동명의면 모두 쉼표(,)로 나눠 적어 주세요.</p>
            <input id="owners" className={styles.input} value={owners}
              onChange={(e) => {
                setOwners(e.target.value);
                setFromRegistryV4((f) => ({ ...f, owners: false }));
              }} />
          </div>

          <UnitFields id="contractUnit" label="계약서 주소" badge={fromContract.unit ? CONTRACT_BADGE : undefined}
            value={contractUnit}
            onChange={(u) => {
              setContractUnit(u);
              setFromContract((f) => ({ ...f, unit: false }));
            }} />
          <UnitFields id="registryUnit" label="등기부 주소" badge={fromRegistryV4.unit ? REGISTRY_BADGE : undefined}
            value={registryUnit}
            onChange={(u) => {
              setRegistryUnit(u);
              setFromRegistryV4((f) => ({ ...f, unit: false }));
            }} />

          <div className={styles.field}>
            <label htmlFor="publicPrice" className={styles.label}>공시가격 (만원)</label>
            <p className={styles.hint}>
              빌라(연립·다세대)의 보증보험 판단에 필요해요.{" "}
              <a href={REALTY_PRICE_URL} target="_blank" rel="noreferrer" className={styles.link}>
                부동산공시가격알리미(realtyprice.kr)
              </a>
              에서 &lsquo;공동주택 공시가격&rsquo;을 찾아 넣어 주세요.
            </p>
            <input id="publicPrice" type="number" inputMode="numeric" min={0} step={1} className={styles.input}
              value={publicPrice} onChange={(e) => setPublicPrice(e.target.value)} />
          </div>
        </fieldset>

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
  const { grade, hits, missing, errors, metrics, landlord, address, depositMismatch, guarantee } = result;
  return (
    <section className={styles.result} aria-live="polite">
      <h2 className={styles.resultTitle}>확인 결과</h2>

      {grade ? (
        <p className={`${styles.grade} ${GRADE_CLASS[grade]}`}>등급: {grade}</p>
      ) : (
        <p className={styles.noGrade}>아직 등급을 낼 수 없어요. 아래 값을 채우거나 고쳐 주세요.</p>
      )}

      <GuaranteeBox guarantee={guarantee} />

      <div className={styles.block}>
        <h3>계약서·등기부 대조</h3>
        <ul>
          <li>
            집주인: {checkText(landlord, { 일치: "일치", 불일치: "위험: 집주인 불일치", "확인 필요": "확인 필요" })}
          </li>
          <li>주소(지번·동·호수): {checkText(address, { 일치: "일치", 불일치: "확인 필요: 주소 불일치" })}</li>
          {depositMismatch && (
            <li className={styles.errorText}>
              계약서 보증금({depositMismatch.contract.toLocaleString("ko-KR")}만원)과 판정에 넣은 보증금(
              {depositMismatch.entered.toLocaleString("ko-KR")}만원)이 달라요.
            </li>
          )}
        </ul>
      </div>

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

function UnitFields(props: {
  id: string;
  label: string;
  badge?: string;
  value: UnitText;
  onChange: (u: UnitText) => void;
}) {
  const part = (key: keyof UnitText, name: string, placeholder: string) => (
    <div className={styles.field}>
      <label htmlFor={`${props.id}-${key}`} className={styles.hint}>{name}</label>
      <input id={`${props.id}-${key}`} className={styles.input} placeholder={placeholder} value={props.value[key]}
        onChange={(e) => props.onChange({ ...props.value, [key]: e.target.value })} />
    </div>
  );
  return (
    <div className={styles.field}>
      <span className={styles.label}>
        {props.label} (지번·동·호수)
        {props.badge && <span className={styles.badge}>{props.badge}</span>}
      </span>
      <div className={styles.unitRow}>
        {part("jibun", "지번", "9101")}
        {part("dong", "동 (없으면 비움)", "101")}
        {part("ho", "호수", "1203")}
      </div>
    </div>
  );
}

function splitNames(text: string): string[] {
  return text.split(/[,，]/).map((n) => n.trim()).filter((n) => n !== "");
}

function toUnit(u: UnitText) {
  const jibun = u.jibun.trim();
  const ho = u.ho.trim();
  if (jibun === "" || ho === "") return undefined;
  return { jibun, dong: u.dong.trim() || null, ho };
}

function checkText<R extends string>(check: { result: R | null; needs: string[] }, labels: Record<R, string>): string {
  return check.result === null ? `판단하려면 이 값이 필요해요: ${check.needs.join(", ")}` : labels[check.result];
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
