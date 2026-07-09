// 东方财富公开行情补源。
// 用途：给 SGE Au99.99 / 518880 提供与新浪独立的冗余源；只按真实返回字段填充，不臆造。
// 注意：HTTP 在内嵌 Node 环境比 HTTPS 稳（部分网络下 HTTPS 会被对端直接断开），这里使用公开 HTTP 接口。

import type { Quote } from "./types";

const EASTMONEY_URL =
  "http://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f12,f14,f2,f3,f4,f15,f16,f17,f18,f124,f297&secids=118.AU9999,1.518880";

type EastmoneyRow = {
  f2?: number; // 最新价
  f3?: number; // 涨跌幅 %
  f4?: number; // 涨跌额
  f12?: string; // 代码
  f14?: string; // 名称
  f15?: number; // 最高
  f16?: number; // 最低
  f18?: number; // 昨收
  f124?: number; // Unix 秒级行情时间
};

type EastmoneyResponse = {
  data?: {
    diff?: EastmoneyRow[];
  };
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function timestampFromUnixSeconds(value: unknown): string {
  if (isFiniteNumber(value) && value > 0) return new Date(value * 1000).toISOString();
  return new Date().toISOString();
}

function buildQuote(row: EastmoneyRow): Quote | null {
  if (!isFiniteNumber(row.f2) || row.f2 <= 0) return null;

  const code = row.f12;
  const instrumentId = code === "AU9999" ? "sge-au9999" : code === "518880" ? "gold-etf-518880" : null;
  if (!instrumentId) return null;

  const quote: Quote = {
    instrumentId,
    price: row.f2,
    timestamp: timestampFromUnixSeconds(row.f124),
    source: instrumentId === "sge-au9999" ? "东方财富公开行情·SGE Au99.99" : "东方财富公开行情·沪市ETF 518880",
  };

  if (isFiniteNumber(row.f4)) quote.change = row.f4;
  if (isFiniteNumber(row.f3)) quote.changePercent = row.f3;
  if (isFiniteNumber(row.f15) && row.f15 > 0) quote.dayHigh = row.f15;
  if (isFiniteNumber(row.f16) && row.f16 > 0) quote.dayLow = row.f16;

  return quote;
}

export async function fetchEastmoneyQuotes(): Promise<Quote[]> {
  const response = await fetch(EASTMONEY_URL, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 gold-phone-app/0.1",
      Referer: "https://quote.eastmoney.com/",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Eastmoney HTTP ${response.status}`);

  const payload = (await response.json()) as EastmoneyResponse;
  const rows = payload.data?.diff;
  if (!Array.isArray(rows)) return [];

  const quotes: Quote[] = [];
  for (const row of rows) {
    const quote = buildQuote(row);
    if (quote) quotes.push(quote);
  }
  return quotes;
}
