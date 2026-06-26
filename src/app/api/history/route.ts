// 趋势图历史数据 API（PhoneApp 专用，仅「国际黄金-实时视图」）。
//
// 数据来源（实测真实接口，非自采 tick）：
//   新浪国际期货分时 GlobalFuturesService.getGlobalFuturesMinLine?symbol=XAU
//   → 返回当天伦敦金 XAU/USD 每分钟分时（minLine_1d，约数百点，06:00 起到当前分钟）。
//   一打开即有「最近一段时间」的真实分时，无需落盘、无需等待自采。
//
// 两条线（与主程序国际视图口径一致）：
//   - xau-usd：新浪分时真实价（$/盎司）
//   - xau-cny：每个分时点 × 当前实时 USD/CNY ÷ 31.1035（理论换算，非成交价）。
//     新浪不提供 xau-cny 分时，故按当前汇率统一换算（汇率日内波动远小于金价，
//     用于走势对比足够；已在前端/source 标注为理论推算）。
//
// 时区：新浪分时时间戳是【北京时间】墙钟。主程序国际视图按真实 UTC 显示国际时间，
//   故这里把北京时间字符串 -8h 转为真实 UTC 秒级时间戳，与主程序时间轴一致。

import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/quotes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TROY_OUNCE_GRAMS = 31.1035;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MINLINE_URL =
  "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var_XAU=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=XAU";

interface Point {
  time: number; // 秒级真实 UTC 时间戳
  value: number;
}

/** "2026-06-26 20:10:00"（北京墙钟）→ 真实 UTC 秒级时间戳（-8h） */
function beijingWallToUtcSeconds(wall: string): number | null {
  // 解析为各分量，按北京时间组装再减 8h 得到真实 UTC
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  // Date.UTC(北京墙钟) 得到“把北京时刻当UTC”的毫秒，再 -8h = 真实 UTC
  const fakeUtcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!Number.isFinite(fakeUtcMs)) return null;
  return Math.floor((fakeUtcMs - 8 * 3600 * 1000) / 1000);
}

/**
 * 拉取并解析新浪伦敦金当天分时。
 * 返回 [{time(真实UTC秒), value(USD/oz)}]，按时间升序、按分钟去重（同分钟保留最新）。
 *
 * 返回结构（实测）：{ minLine_1d: [ 首行10列, 后续行6列, ... ] }
 *   首行: [日期, 昨收, 交易所, "", "HH:MM", 价格, ..., 均价, "YYYY-MM-DD HH:MM:SS"]
 *   后续: ["HH:MM", 价格, 0, 0, 均价, "YYYY-MM-DD HH:MM:SS"]
 *   价格统一取「完整时间戳前一格」之外最可靠的列：后续行 index 1；首行 index 5。
 *   时间统一取每行【最后一格】的完整北京时间戳。
 */
async function fetchSinaXauIntraday(): Promise<Point[]> {
  const res = await fetch(MINLINE_URL, {
    headers: { "User-Agent": UA, Referer: "https://finance.sina.com.cn/" },
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return [];
  const text = await res.text();
  const match = text.match(/var_XAU=\((\{[\s\S]*\})\);?/);
  if (!match) return [];

  let obj: { minLine_1d?: unknown[] };
  try {
    obj = JSON.parse(match[1]);
  } catch {
    return [];
  }
  const rows = obj.minLine_1d;
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const byMinute = new Map<number, number>();
  for (const raw of rows) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    // 完整时间戳总在最后一格，价格：首行(10列)在 index 5，后续行(6列)在 index 1。
    const full = String(raw[raw.length - 1]);
    if (!/^\d{4}-\d{2}-\d{2}\s/.test(full)) continue;
    const priceStr = raw.length >= 10 ? raw[5] : raw[1];
    const price = Number(priceStr);
    if (!Number.isFinite(price) || price <= 0) continue;
    const t = beijingWallToUtcSeconds(full);
    if (t === null) continue;
    byMinute.set(t, price); // 同分钟覆盖，保留最新
  }

  const pts: Point[] = [...byMinute.entries()]
    .map(([time, value]) => ({ time, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.time - b.time);
  return pts;
}

export async function GET() {
  const series: Record<string, Point[]> = {};
  const sources: Record<string, string> = {};

  // 伦敦金分时 + 当前实时汇率（并行）
  const [xauUsd, quotesResult] = await Promise.allSettled([
    fetchSinaXauIntraday(),
    getQuotes(),
  ]);

  const usd = xauUsd.status === "fulfilled" ? xauUsd.value : [];
  if (usd.length > 0) {
    series["xau-usd"] = usd;
    sources["xau-usd"] = "新浪国际期货·伦敦金XAU/USD当日分时";

    // 当前实时 USD/CNY，用于把每个分时点换算成人民币理论金价
    let usdCny: number | null = null;
    if (quotesResult.status === "fulfilled") {
      const q = quotesResult.value.quotes.find((x) => x.instrumentId === "usd-cny");
      if (q && Number.isFinite(q.price) && q.price > 0) usdCny = q.price;
    }
    if (usdCny !== null) {
      series["xau-cny"] = usd.map((p) => ({
        time: p.time,
        value: Math.round(((p.value * usdCny!) / TROY_OUNCE_GRAMS) * 100) / 100,
      }));
      sources["xau-cny"] =
        "推算：伦敦金分时 × 当前实时USD/CNY ÷ 31.1035（理论价，非成交价）";
    }
    // 汇率不可用时不返回 xau-cny（只展示可用真实数据，不臆造）
  }

  return NextResponse.json(
    { series, sources },
    { headers: { "Cache-Control": "no-cache, no-store, must-revalidate" } },
  );
}
