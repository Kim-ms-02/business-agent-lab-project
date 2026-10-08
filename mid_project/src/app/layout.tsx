import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "전세레이더",
  description: "등기부등본과 계약서로 전세 사기·깡통전세 위험을 확인하도록 돕는 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
