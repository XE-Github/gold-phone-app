import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "黄金看板·手机版",
  description:
    "面向中国黄金小白的手机网页看板：实时金价 + 价格提醒、银行积存金对比。数据独立抓取，真实来源标注，非投资建议。",
  applicationName: "黄金看板手机版",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "黄金看板",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1020",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
