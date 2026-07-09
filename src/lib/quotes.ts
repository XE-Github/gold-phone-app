// 行情编排（PhoneApp 独立实现）。
// 多源合并不再固定“后者覆盖前者”：同一标的优先保留源头 timestamp 更新的报价。
// 这样 Gold-API 的伦敦金不会被更旧的新浪 hf_XAU 覆盖；SGE/ETF 可在新浪与东方财富间择新。

import type { Quote } from "./types";
import { fetchSinaQuotes } from "./sina";
import { fetchGoldApiQuotes } from "./goldApi";
import { fetchEastmoneyQuotes } from "./eastmoney";
import { buildComputedQuotes } from "./computed";

function quoteTime(q: Quote): number {
  const t = new Date(q.timestamp).getTime();
  return Number.isFinite(t) ? t : 0;
}

function sourceRank(source: string): number {
  if (source.includes("Gold-API")) return 4;
  if (source.includes("东方财富")) return 3;
  if (source.includes("新浪")) return 2;
  return 1;
}

function mergeQuote(old: Quote | undefined, incoming: Quote): Quote {
  if (!old) return incoming;

  const oldTime = quoteTime(old);
  const newTime = quoteTime(incoming);
  if (newTime > oldTime) return incoming;
  if (oldTime > newTime) return old;

  // 同 timestamp 时按源优先级稳定择源，避免结果随 Promise 顺序抖动。
  return sourceRank(incoming.source) >= sourceRank(old.source) ? incoming : old;
}

function mergeInto(byId: Map<string, Quote>, quotes: Quote[]) {
  for (const q of quotes) byId.set(q.instrumentId, mergeQuote(byId.get(q.instrumentId), q));
}

export async function getQuotes(): Promise<{ quotes: Quote[]; warnings: string[] }> {
  const byId = new Map<string, Quote>();
  const warnings: string[] = [];

  const [goldApi, sina, eastmoney] = await Promise.allSettled([
    fetchGoldApiQuotes(),
    fetchSinaQuotes(),
    fetchEastmoneyQuotes(),
  ]);

  if (goldApi.status === "fulfilled") {
    mergeInto(byId, goldApi.value);
  } else {
    warnings.push("Gold-API 备用源暂时不可用");
  }

  if (sina.status === "fulfilled") {
    mergeInto(byId, sina.value);
  } else {
    warnings.push("新浪财经主源暂时不可用，行情可能不完整");
  }

  if (eastmoney.status === "fulfilled") {
    mergeInto(byId, eastmoney.value);
  } else {
    warnings.push("东方财富补源暂时不可用");
  }

  // 计算标的：xau-cny 人民币理论金价、金银比
  mergeInto(byId, buildComputedQuotes(byId));

  return { quotes: [...byId.values()], warnings };
}
