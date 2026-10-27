// v0.5 체크리스트 코치: the 17 items of the 국토교통부 안내서 체크리스트 (molit-guide PDF 1~2쪽), wording approved
// by the user (2026-10-27). Pages are the printed page numbers of the guide's body text.
// Do not change a sentence here without the user's approval; the AI never writes or edits these.
import { DEFAULT_QUESTIONS, GLOSSARY } from "../agent/content";
import type { GlossaryEntry } from "../agent/explain";

export type Stage = "계약 전" | "계약할 때" | "계약 후";
export type StatusKind = "ok" | "hit" | "input" | "manual";
export type ChecklistQuestion = { text: string; source: string; to?: "중개사" };

export type ChecklistItem = {
  no: number;
  stage: Stage;
  title: string;
  deep: boolean; // 안내서의 심화 사항
  auto: boolean; // status comes from the rule engine
  guide: string; // 안내 문구: what to check and where
  source: string;
  questions: ChecklistQuestion[];
  terms: GlossaryEntry[];
};

export const STATUS_LABELS: Record<StatusKind, string> = {
  ok: "✅ 앱이 확인함",
  hit: "⚠ 걸림",
  input: "✏️ 입력하면 확인할 수 있어요",
  manual: "❓ 직접 확인",
};

const G = (page: number) => `molit-guide#${page}쪽`;
const src = (pages: string) => `안내서 체크리스트 + 본문 ${pages}쪽`;
const term = (name: string): GlossaryEntry => {
  const found = GLOSSARY.find((g) => g.term === name);
  if (!found) throw new Error(`glossary term missing: ${name}`);
  return found;
};

type Draft = Omit<ChecklistItem, "no" | "deep" | "auto" | "questions" | "terms"> &
  Partial<Pick<ChecklistItem, "deep" | "auto" | "questions" | "terms">>;

const DRAFTS: Draft[] = [
  // 계약 전
  {
    stage: "계약 전",
    title: "전세 시세 조사",
    auto: true,
    guide:
      "시세보다 보증금이 크게 높지 않은 집인지 실거래가 공개시스템(rt.molit.go.kr), 안심전세App, 공인중개사 사무소에서 확인하세요. 앱의 시세는 실거래로 추정한 값이에요.",
    source: src("15~20"),
    questions: [DEFAULT_QUESTIONS.jeonseRatio[0]],
  },
  {
    stage: "계약 전",
    title: "등기부 권리관계",
    auto: true,
    guide:
      "갑구(압류 등 소유권 관련)와 을구(근저당·전세권·임차권)에서 내 보증금보다 먼저 돌려받는 권리를 확인하세요. 등기부가 없는 신축 건물은 주의하세요.",
    source: src("21"),
  },
  {
    stage: "계약 전",
    title: "등기부에 없는 선순위채권",
    guide:
      "확정일자 부여현황·전입세대확인서(주민센터), 국세 완납증명서(세무서·홈택스), 지방세 완납증명서(주민센터·위택스)로 확인하세요. 계약 전에는 집주인이나 공인중개사를 통해 볼 수 있어요. 집주인의 동의가 필요해요.",
    source: src("25~26"),
    questions: [
      { text: "계약 전에 국세·지방세 완납증명서, 확정일자 부여현황, 전입세대확인서를 보여 주실 수 있나요?", source: G(26) },
    ],
  },
  {
    stage: "계약 전",
    title: "건축물대장·건축물 현황도",
    guide:
      "세움터(cloud.eais.go.kr)에서 건축물대장이 있는지, '위반건축물'이 적혀 있지 않은지 보세요. 건축물 현황도로 실제 집과 같은지도 확인하세요.",
    source: src("18~19"),
    questions: [{ text: "건축물대장에 위반건축물로 적혀 있지 않나요? 계약서의 호수가 건축물대장과 같나요?", source: G(19) }],
  },
  {
    stage: "계약 전",
    title: "전세보증보험 가입 가능 여부",
    auto: true,
    guide: "HUG·HF·SGI 홈페이지에서 가입 조건을 확인하고 전화로 문의하세요. 앱은 HUG 기준만 계산해요.",
    source: `${src("37")} · 계산 기준: HUG 상품개요 2쪽`,
    questions: [DEFAULT_QUESTIONS.guarantee[0]],
  },
  // 계약할 때
  {
    stage: "계약할 때",
    title: "공인중개사 정상 영업",
    guide:
      "사무소에 걸린 공인중개사 자격증, 중개사무소 개설등록증, 공제증서, 사업자등록증을 확인하세요. 브이월드(www.vworld.kr)의 부동산중개업 조회로 정상 영업 중인지도 볼 수 있어요.",
    source: src("27"),
    questions: [{ text: "중개사무소 개설등록증과 공제증서를 볼 수 있을까요?", source: G(27), to: "중개사" }],
  },
  {
    stage: "계약할 때",
    title: "주택임대차표준계약서 사용 (권장)",
    guide: "법무부 홈페이지(moj.go.kr) 등에서 받을 수 있는 주택임대차표준계약서나 한국공인중개사협회 계약서를 쓰는 것을 권장해요.",
    source: src("28"),
    questions: [{ text: "주택임대차표준계약서로 계약할 수 있을까요?", source: G(28) }],
  },
  {
    stage: "계약할 때",
    title: "소유자(임대인)와 계약자 일치",
    auto: true,
    guide: "주민등록증·여권 진위(정부24, 국번 없이 1382)와 운전면허증 진위(도로교통공단 안전운전 통합민원)를 확인하세요.",
    source: src("30"),
    questions: [DEFAULT_QUESTIONS.landlord[0], DEFAULT_QUESTIONS.landlord[2]],
  },
  {
    stage: "계약할 때",
    title: "대리인 권한 확인",
    deep: true,
    auto: true,
    guide: "대리인과 계약하면 다음 서류를 확인하세요: 위임장 원본(위임인 인감도장), 인감증명서, 위임인 신분증 사본, 대리인 신분증.",
    source: src("31"),
    questions: [DEFAULT_QUESTIONS.landlord[1]],
  },
  {
    stage: "계약할 때",
    title: "특약사항 설정 (권장)",
    deep: true,
    guide:
      "확정일자와 전입신고 다음 날까지 근저당 등 담보권을 설정하지 않기로 하고, 어기면 바로 계약을 해지하고 손해배상하는 특약을 넣으면 좋아요.",
    source: src("29"),
    questions: [
      { text: "확정일자와 전입신고 다음 날까지 담보권을 설정하지 않는다는 특약을 넣을 수 있나요?", source: G(29) },
    ],
  },
  // 계약 후
  {
    stage: "계약 후",
    title: "주택임대차계약 신고",
    guide: "신고 대상이면 계약일부터 30일 안에 주민센터나 부동산거래관리시스템(rtms.molit.go.kr)에서 신고하세요.",
    source: src("31"),
  },
  {
    stage: "계약 후",
    title: "확정일자 받기",
    guide: "신고 대상이 아니면 주민센터나 법원 등기소(인터넷등기소 포함)에서 확정일자를 받으세요.",
    source: src("32"),
    terms: [term("대항력"), term("우선변제권")],
  },
  {
    stage: "계약 후",
    title: "잔금 전 권리관계 다시 확인",
    deep: true,
    guide: "잔금 전에 등기부를 다시 떼어 갑구·을구에 바뀐 것이 없는지 보세요. 확정일자 부여현황과 전입세대확인서도 다시 확인하세요.",
    source: src("33"),
    questions: [DEFAULT_QUESTIONS.titleIssues[1]],
  },
  {
    stage: "계약 후",
    title: "소유자(임대인)와 예금주 일치",
    deep: true,
    guide: "잔금은 계약서에 적힌 계좌로 보내고, 예금주가 소유자(임대인)인지 먼저 확인하세요.",
    source: src("35"),
    questions: [{ text: "잔금 계좌의 예금주가 등기부 소유자와 같은 분인가요?", source: G(35) }],
  },
  {
    stage: "계약 후",
    title: "주택의 인도",
    guide: "열쇠나 도어락 비밀번호를 받아 집을 넘겨받고, 잔금을 낼 때 바로 입주하세요.",
    source: src("36"),
  },
  {
    stage: "계약 후",
    title: "전입신고",
    guide: "이사한 날 주민센터나 정부24(www.gov.kr)에서 전입신고를 하세요.",
    source: src("36"),
    terms: [term("대항력"), term("우선변제권")],
  },
  {
    stage: "계약 후",
    title: "전세보증보험 가입",
    guide: "가입을 권장해요. 신청은 계약 기간의 절반이 지나기 전까지예요. 가입이 됐는지 직접 확인하세요.",
    source: src("37"),
  },
];

export const CHECKLIST_ITEMS: ChecklistItem[] = DRAFTS.map((d, i) => ({
  deep: false,
  auto: false,
  questions: [],
  terms: [],
  ...d,
  no: i + 1,
}));

// 심화 사항 left out this time; listed under 알려진 한계.
export const EXCLUDED_ITEMS: { title: string; pages: string }[] = [
  { title: "최우선변제 가능 금액", pages: "24~25쪽" },
  { title: "특약 이행 여부 확인(도배·장판·집 수리 등)", pages: "34쪽" },
  { title: "임차주택 입주 가능 여부", pages: "34쪽" },
  { title: "잔금 이체 내역", pages: "34쪽" },
  { title: "잔금 정확히 이체", pages: "35쪽" },
  { title: "대항력 확보", pages: "22쪽" },
  { title: "우선변제권 확보", pages: "22쪽" },
  { title: "특약 이행 여부 확인(담보권 설정 등)", pages: "36쪽" },
];
