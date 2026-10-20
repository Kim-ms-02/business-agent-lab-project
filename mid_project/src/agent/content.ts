// Approved wording for v0.5 explanations (step 5): search queries, the chunks each query must find,
// default questions and plain-word glossary. Every question and term names the chunk it rests on;
// it is shown only when that chunk was found (finalizeReport / visibleGlossary).
// Chunk ids come from docs/sources/chunks.json. When the documents change, rerun tests/retrieveReal.test.ts.
import type { GlossaryEntry, TopicId } from "./explain";

const G = (page: number) => `molit-guide#${page}쪽`; // 전세계약 제대로 알고 하기, printed page
const H = (page: number) => `hug-guarantee#${page}쪽`; // HUG 전세보증금반환보증 상품개요
const P = (page: number) => `molit-press-333#${page}쪽`; // 국토교통부 3·3·3 보도자료
const LAW = (article: string) => `housing-lease-act#${article}`; // 주택임대차보호법

// One fixed query per topic; the topic's facts are never part of the query.
export const TOPIC_QUERIES: Record<TopicId, string> = {
  jeonseRatio: "깡통전세 대출금과 전세보증금 합계 매매가격 시세조사",
  seniorBurden: "선순위 근저당권 채권최고액 을구 보증금 반환 권리관계",
  titleIssues: "갑구 압류 가압류 가처분 경매개시결정 가등기 신탁등기 신탁원부 소유권 제한",
  recentTransfer: "소유권 이전 소유자 변경 갑구 소유자 변동 확인",
  landlord: "임대인 소유자 동일인 계약당사자 확인 대리인 위임장 법인 공동 소유자 전원",
  address: "표제부 주소 동호수 일치 건축물대장 계약서 주소",
  guarantee: "전세보증금반환보증 반환을 책임지는 보증상품 가입 조건 전세보증금 선순위채권 주택가격 담보인정비율 수도권 7억",
  "tenancy:전세권": "을구 전세권 말소 전세권 설정 선순위 권리",
  "tenancy:임차권": "임차권등기 임차권등기명령 최우선변제 보증금 반환받지 못한",
  basics: "시세 조사 등기부 권리관계 보증보험 가입 확정일자 전입신고 대항력 우선변제권 3·3·3 법칙",
};

// Chunks each query must return in its top SEARCH_TOP_K (checked in tests/retrieveReal.test.ts).
export const EXPECTED_CHUNKS: Record<TopicId, string[]> = {
  jeonseRatio: [G(16)],
  seniorBurden: [G(102), G(21)],
  titleIssues: [G(101), G(21)],
  recentTransfer: [G(41), G(33)],
  landlord: [G(30), G(31)],
  address: [G(99)],
  guarantee: [H(2), H(3), H(1)],
  "tenancy:전세권": [G(102)],
  "tenancy:임차권": [G(45), LAW("제3조의3")],
  basics: [P(2), G(22), G(13)],
};

export type SourcedQuestion = { text: string; source: string };

// Shown only when the AI's questions for a topic were all dropped.
export const DEFAULT_QUESTIONS: Record<TopicId, SourcedQuestion[]> = {
  jeonseRatio: [{ text: "집에 있는 대출금과 제 보증금을 더하면 집값을 넘지 않나요?", source: G(16) }],
  seniorBurden: [{ text: "을구에 있는 근저당권 말고 저보다 먼저 돌려받는 권리가 더 있나요?", source: G(102) }],
  titleIssues: [
    { text: "갑구에 있는 이 기재는 왜 생겼고, 언제 말소되나요?", source: G(101) },
    { text: "잔금 전에 등기부를 다시 떼어 봐도 될까요?", source: G(33) },
    { text: "신탁등기라면 신탁원부와 신탁사의 동의를 확인할 수 있나요?", source: G(21) },
  ],
  recentTransfer: [
    { text: "최근에 소유자가 바뀐 이유는 무엇인가요?", source: G(41) },
    { text: "잔금 날 갑구의 소유자가 계약할 때와 같은지 다시 확인해도 될까요?", source: G(33) },
  ],
  landlord: [
    { text: "신분증으로 등기부의 소유자 본인인지 확인할 수 있나요?", source: G(30) },
    { text: "대리인이라면 인감도장이 찍힌 위임장 원본과 인감증명서를 보여 주실 수 있나요?", source: G(31) },
    { text: "소유자가 여러 명이면 모두와 계약할 수 있나요?", source: G(30) },
  ],
  address: [{ text: "계약서 주소와 동·호수가 등기부·건축물대장과 같은지 함께 확인해 주실 수 있나요?", source: G(99) }],
  guarantee: [{ text: "이 집은 전세보증금반환보증에 가입할 수 있나요? 보증기관에 미리 확인해도 될까요?", source: H(2) }],
  "tenancy:전세권": [{ text: "을구에 남은 전세권은 언제 말소되나요?", source: G(102) }],
  "tenancy:임차권": [{ text: "이전 세입자가 보증금을 돌려받지 못해 임차권등기를 한 것인가요? 지금은 돌려받았나요?", source: G(45) }],
  basics: [{ text: "계약 전에 등기부를 함께 보고, 보증보험 가입이 되는 집인지 확인해 주실 수 있나요?", source: P(2) }],
};

export const GLOSSARY: GlossaryEntry[] = [
  { term: "깡통전세", plain: "대출금과 전세보증금을 더한 돈이 집의 매매가격을 넘는 집", source: G(16) },
  { term: "선순위 권리", plain: "내 보증금보다 먼저 돌려받는 권리(근저당권·전세권·임차권 등)", source: G(21) },
  { term: "근저당권", plain: "집을 담보로 빌린 돈을 정한 한도까지 다른 사람보다 먼저 돌려받는 권리", source: G(102) },
  { term: "갑구", plain: "등기부에서 소유자와 소유권을 제한하는 권리가 적힌 곳", source: G(21) },
  { term: "을구", plain: "등기부에서 근저당권·전세권·임차권이 적힌 곳", source: G(21) },
  { term: "압류", plain: "빚이나 세금을 내지 않아 소유자가 집을 처분하지 못하게 묶은 등기", source: G(101) },
  { term: "가압류", plain: "돈을 받을 사람이 나중의 강제집행에 대비해 집을 미리 묶어 두는 절차", source: G(101) },
  { term: "가처분", plain: "집이 팔리는 등으로 내 권리를 지키기 어려워지지 않도록, 법원이 미리 \"이건 하지 마세요\"라고 막아 둔 것", source: G(101) },
  { term: "가등기", plain: "나중에 소유권 등을 옮기거나 바꿀 권리를 지키려고 미리 해 두는 등기", source: G(101) },
  { term: "경매개시결정", plain: "법원이 경매를 시작한다고 정한 것. 이때 집이 압류됨", source: G(101) },
  { term: "신탁등기", plain: "집에 대한 권한이 신탁사에 맡겨졌다는 등기", source: G(21) },
  { term: "전세보증금반환보증", plain: "전세계약이 끝났을 때 집주인이 돌려줘야 할 전세보증금을 돌려받도록 책임져 주는 보증상품", source: H(1) },
  { term: "담보인정비율", plain: "HUG가 보증 한도를 계산할 때 주택가격에 곱하는 비율", source: H(2) },
  { term: "전세권", plain: "전세금을 내고 그 권리를 등기부에 적은 것. 등기된 순서대로 먼저 돌려받음", source: G(102) },
  { term: "임차권등기", plain: "보증금을 못 받고 이사할 때 등기부에 적어 대항력과 순위를 지키는 것", source: G(45) },
  { term: "대항력", plain: "집주인이 바뀌어도 내 계약을 주장할 수 있는 힘. 입주와 전입신고를 마친 다음 날 생김", source: G(22) },
  { term: "우선변제권", plain: "집이 경매로 넘어가도 뒤 순위보다 먼저 보증금을 받을 권리. 대항력에 확정일자를 더하면 생김", source: G(22) },
  { term: "확정일자", plain: "계약 후 주민센터나 법원 등기소에서 받는 것. 받아 두면 보증금을 먼저 돌려받을 권리(우선변제권)의 요건 하나를 갖춤", source: G(13) },
];
