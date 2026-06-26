// 行情编排（PhoneApp 独立实现）。
// 合并顺序很关键：Gold-API 先并入，新浪后并入覆盖它 —— 新浪带 dayHigh/dayLow，
// 若 Gold-API 后并会抹掉这些真实日高低。最后追加计算标的（xau-cny 等）。

import type { Quote } from "./types";
import { fetchSinaQuotes } from "./sina";
import { fetchGoldApiQuotes } from "./goldApi";
import { buildComputedQuotes } from "./computed";

function mergeInto(byId: Map<string, Quote>, quotes: Quote[]) {
  for (const q of quotes) byId.set(q.instrumentId, q);
}

export async function getQuotes(): Promise<{ quotes: Quote[]; warnings: string[] }> {
  const byId = new Map<string, Quote>();
  const warnings: string[] = [];

  const [goldApi, sina] = await Promise.allSettled([
    fetchGoldApiQuotes(),
    fetchSinaQuotes(),
  ]);

  // Gold-API 先并入（只有 price）
  if (goldApi.status === "fulfilled") {
    mergeInto(byId, goldApi.value);
  } else {
    warnings.push("Gold-API 备用源暂时不可用");
  }

  // 新浪后并入，覆盖 Gold-API（带真实 dayHigh/dayLow/change）
  if (sina.status === "fulfilled") {
    mergeInto(byId, sina.value);
  } else {
    warnings.push("新浪财经主源暂时不可用，行情可能不完整");
  }

  // 计算标的：xau-cny 人民币理论金价、金银比
  mergeInto(byId, buildComputedQuotes(byId));

  return { quotes: [...byId.values()], warnings };
}
