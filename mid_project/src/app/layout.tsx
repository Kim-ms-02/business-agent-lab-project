import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "전세 체크리스트 코치",
  description: "등기부등본을 쉬운 말로 요약하고, 국토교통부 안내서 체크리스트로 전세 계약 전·중·후에 확인할 일을 알려주는 도구",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
