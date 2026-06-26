// 衍生/计算标的（PhoneApp 独立实现）。
// xau-cny 人民币理论金价 = XAU/USD × USD/CNY ÷ 31.1035（理论价，非成交价）。
// gold-silver-ratio 金银比 = 金价 ÷ 银价。

import type { Quote } from "./types";

const TROY_OUNCE_GRAMS = 31.1035;

function isUsable(q?: Quote): q is Quote {
  return !!q && q.price > 0 && !q.stale;
}

function latestTimestamp(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

// 在已有 quotes 基础上补充计算标的。返回新增的计算 quotes（不修改入参）。
export function buildComputedQuotes(byId: Map<string, Quote>): Quote[] {
  const out: Quote[] = [];

  const xauUsd = byId.get("xau-usd");
  const usdCny = byId.get("usd-cny");
  const xagUsd = byId.get("xag-usd");

  if (isUsable(xauUsd) && isUsable(usdCny)) {
    const raw = (xauUsd.price * usdCny.price) / TROY_OUNCE_GRAMS;
    const quote: Quote = {
      instrumentId: "xau-cny",
      price: Math.round(raw * 100) / 100,
      timestamp: latestTimestamp(xauUsd.timestamp, usdCny.timestamp),
      source: "自动计算：XAU/USD × USD/CNY ÷ 31.1035",
    };
    if (xauUsd.dayHigh != null) {
      quote.dayHigh = Math.round(((xauUsd.dayHigh * usdCny.price) / TROY_OUNCE_GRAMS) * 100) / 100;
    }
    if (xauUsd.dayLow != null) {
      quote.dayLow = Math.round(((xauUsd.dayLow * usdCny.price) / TROY_OUNCE_GRAMS) * 100) / 100;
    }
    if (xauUsd.changePercent != null) quote.changePercent = xauUsd.changePercent;
    out.push(quote);
  }

  if (isUsable(xauUsd) && isUsable(xagUsd)) {
    out.push({
      instrumentId: "gold-silver-ratio",
      price: Math.round((xauUsd.price / xagUsd.price) * 100) / 100,
      timestamp: latestTimestamp(xauUsd.timestamp, xagUsd.timestamp),
      source: "自动计算：黄金价格 ÷ 白银价格",
    });
  }

  return out;
}
