// 趋势图历史数据 API（PhoneApp 专用，仅「国际黄金-实时视图」）。
//
// 与主项目的 /api/history 不同：PhoneApp 只搬来「国际实时(24h)」一个视图，
// 数据来自本应用自己的内存 tick 缓冲（真实 UTC 分时），不做日K、不做国内/汇率视图。
// 缓冲为空时返回空 series（前端显示"等待采集"，绝不画估算线）。

import { NextResponse } from "next/server";
import { getTickHistory } from "@/lib/tickBuffer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface Point {
  time: number;
  value: number;
}

export async function GET() {
  const series: Record<string, Point[]> = {};
  const sources: Record<string, string> = {};

  // 国际实时：伦敦金 + 国内理论金价，均来自 tick 缓冲（真实 UTC）
  const tick = getTickHistory(24);
  const meta: Record<string, string> = {
    "xau-usd": "新浪/Gold-API实时伦敦金·本机采集分时(UTC)",
    "xau-cny": "实时推算国内理论金价·本机采集分时(UTC)",
  };
  for (const id of ["xau-usd", "xau-cny"]) {
    const pts = tick[id];
    if (!pts || pts.length === 0) continue;
    series[id] = pts.map((p) => ({
      time: p.time,
      value: Math.round(p.value * 100) / 100,
    }));
    sources[id] = meta[id];
  }

  return NextResponse.json(
    { series, sources },
    { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } },
  );
}
