// 行情快照接口（PhoneApp 专用）。手机前端轮询此接口拿实时金价。
// 数据独立抓取（新浪 + Gold-API + 计算），不调用主项目任何接口。

import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/quotes";
import { captureTicks } from "@/lib/tickBuffer";
import type { QuotesPayload } from "@/lib/types";

export const dynamic = "force-dynamic"; // 始终实时抓取，不做静态缓存
export const revalidate = 0;

export async function GET() {
  try {
    const { quotes, warnings } = await getQuotes();
    // 把 xau-usd / xau-cny 落入分时缓冲，供「国际实时」趋势图取过去24h历史。
    // 前端每 5s 轮询此接口 → 缓冲随时间逐分钟填充（不预填、不臆造历史）。
    captureTicks(quotes);
    const payload: QuotesPayload = {
      quotes,
      warnings,
      serverTime: Date.now(),
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      { quotes: [], warnings: [`行情抓取失败：${message}`], serverTime: Date.now() } satisfies QuotesPayload,
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
