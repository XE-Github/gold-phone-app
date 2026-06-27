// 趋势图历史数据抓取（PhoneApp 数据层，无 Next 依赖）。
//
// 从 src/app/api/history/route.ts 抽出，算法一字不改，仅去掉 Next 包装，
// 以便「内嵌 Node 服务」与「web 调试」复用同一份逻辑（单一事实来源，不分叉）。
//
// 数据来源（实测真实接口，非自采 tick）：
//   新浪国际期货分时 GlobalFuturesService.getGlobalFuturesMinLine?symbol=XAU
//   → 当天伦敦金 XAU/USD 每分钟分时（minLine_1d，约数百点，06:00 起到当前分钟）。
// 两条线：xau-usd（新浪分时真实价 $/oz）；xau-cny（每点 × 当前实时 USD/CNY ÷ 31.1035，理论换算）。
// 时区：新浪分时是【北京时间】墙钟，-8h 转真实 UTC 秒级时间戳，与前端图表 UTC 轴一致。

import { getQuotes } from "./quotes";

const TROY_OUNCE_GRAMS = 31.1035;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MINLINE_URL =
  "https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var_XAU=/GlobalFuturesService.getGlobalFuturesMinLine?symbol=XAU";

export interface HistoryPoint {
  time: number; // 秒级真实 UTC 时间戳
  value: number;
}

export interface HistoryPayload {
  series: Record<string, HistoryPoint[]>;
  sources: Record<string, string>;
}

/** "2026-06-26 20:10:00"（北京墙钟）→ 真实 UTC 秒级时间戳（-8h） */
function beijingWallToUtcSeconds(wall: string): number | null {
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  const fakeUtcMs = Date.UTC(y, mo - 1, d, h, mi, s);
  if (!Number.isFinite(fakeUtcMs)) return null;
  return Math.floor((fakeUtcMs - 8 * 3600 * 1000) / 1000);
}

/**
 * 拉取并解析新浪伦敦金当天分时。
 * 返回 [{time(真实UTC秒), value(USD/oz)}]，按时间升序、按分钟去重（同分钟保留最新）。
 */
async function fetchSinaXauIntraday(): Promise<HistoryPoint[]> {
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

  const pts: HistoryPoint[] = [...byMinute.entries()]
    .map(([time, value]) => ({ time, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.time - b.time);
  return pts;
}

/** 抓取趋势图历史（伦敦金分时 + 人民币理论分时）。无数据则返回空 series。 */
export async function fetchHistory(): Promise<HistoryPayload> {
  const series: Record<string, HistoryPoint[]> = {};
  const sources: Record<string, string> = {};

  const [xauUsd, quotesResult] = await Promise.allSettled([
    fetchSinaXauIntraday(),
    getQuotes(),
  ]);

  const usd = xauUsd.status === "fulfilled" ? xauUsd.value : [];
  if (usd.length > 0) {
    series["xau-usd"] = usd;
    sources["xau-usd"] = "新浪国际期货·伦敦金XAU/USD当日分时";

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

  return { series, sources };
}
