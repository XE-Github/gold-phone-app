// Gold-API 免费实时源（PhoneApp 独立实现）：伦敦金/银的备用源。
// 只提供 price，不带 dayHigh/dayLow/change —— 故合并时必须让新浪在后覆盖它。

import type { Quote } from "./types";

const GOLD_API_SYMBOLS: Record<string, string> = {
  XAU: "xau-usd",
  XAG: "xag-usd",
};

type GoldApiResponse = {
  symbol?: string;
  name?: string;
  price?: number;
  updatedAt?: string;
};

async function fetchOne(symbol: string): Promise<Quote | null> {
  const url = `https://api.gold-api.com/price/${symbol}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "gold-phone-app/0.1",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Gold-API HTTP ${response.status}`);
  const payload = (await response.json()) as GoldApiResponse;
  if (typeof payload.price !== "number" || !Number.isFinite(payload.price)) {
    return null;
  }
  return {
    instrumentId: GOLD_API_SYMBOLS[symbol],
    price: payload.price,
    timestamp: payload.updatedAt ?? new Date().toISOString(),
    source: "Gold-API 免费实时源",
  };
}

export async function fetchGoldApiQuotes(): Promise<Quote[]> {
  const results = await Promise.allSettled(
    Object.keys(GOLD_API_SYMBOLS).map((s) => fetchOne(s)),
  );
  const quotes: Quote[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) quotes.push(r.value);
  }
  return quotes;
}
