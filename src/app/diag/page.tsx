"use client";

// /diag 路由页：仅作为 DiagPanel 的整页外壳（embedded=false），供 PC 浏览器 dev 直接访问 /diag 调试。
// ⚠️ App 内不走这个路由——静态导出(output:export)产出扁平 diag.html，主页用
//   <a href="/diag"> 在 Capacitor file:// 下找不到该文件，会打不开。故 App 里由「我的」页打开
//   全屏二级页 <DiagView>（内部 <DiagPanel embedded/>），顶部「← 返回」退出，绕开路由跳转。

import { DiagPanel } from "@/components/DiagPanel";

export default function DiagPage() {
  return <DiagPanel />;
}
