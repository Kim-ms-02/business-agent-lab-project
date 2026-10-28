// The house types this app reads from a 집합건물 등기부 (1동 건물내역) and uses for the 보증보험 house price.

export type HouseType = "apartment" | "rowhouse" | "officetel";

export const HOUSE_TYPE_LABELS: Record<HouseType, string> = {
  apartment: "아파트",
  rowhouse: "빌라(연립·다세대)",
  officetel: "오피스텔",
};
