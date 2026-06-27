"use client";

// /diag 路由页：仅作为 DiagPanel 的整页外壳，供 PC 浏览器 dev 直接访问 /diag 调试。
// ⚠️ App 内不走这个路由——静态导出(output:export)产出扁平 diag.html，主页用
//   <a href="/diag"> 在 Capacitor file:// 下找不到该文件，会打不开。故 App 里由主页
//   「同页全屏弹层」直接渲染 <DiagPanel onClose=…/>，彻底绕开路由跳转（详见 DiagPanel.tsx）。

import { DiagPanel } from "@/components/DiagPanel";

export default function DiagPage() {
  return <DiagPanel />;
}
