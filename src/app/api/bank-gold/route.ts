// 银行积存金对比接口（PhoneApp 专用）。
// 先抓行情拿 SGE Au99.99 / 人民币理论价作估算兜底基准，再抓各行积存金报价。
// 数据独立抓取，不调用主项目任何接口。

import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/quotes";
import { fetchBankGoldQuotes } from "@/lib/bankGold";
import type { BankGoldPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    // 取基准价：SGE Au99.99 优先，退而求人民币理论价（仅用于兜底估算的银行）
    const { quotes } = await getQuotes();
    const sgeAu = quotes.find((q) => q.instrumentId === "sge-au9999")?.price;
    const xauCny = quotes.find((q) => q.instrumentId === "xau-cny")?.price;

    const { quotes: bankQuotes, realCount } = await fetchBankGoldQuotes(sgeAu, xauCny);

    const warnings: string[] = [];
    if (realCount === 0) {
      warnings.push("当前所有银行报价均来自估算兜底，未取到真实直连数据");
    }

    const payload: BankGoldPayload = {
      quotes: bankQuotes,
      realCount,
      total: bankQuotes.length,
      warnings,
      serverTime: Date.now(),
    };
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return NextResponse.json(
      {
        quotes: [],
        realCount: 0,
        total: 0,
        warnings: [`积存金抓取失败：${message}`],
        serverTime: Date.now(),
      } satisfies BankGoldPayload,
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
