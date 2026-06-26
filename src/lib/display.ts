// 纯展示辅助（客户端安全，不引服务端抓取代码）。
// 红涨绿跌（中国习惯）：涨/利多=rose(红)，跌/利空=emerald(绿)。

import type { Quote, QuoteMeta } from "./types";

// 手机看板要展示的行情标的（顺序即展示顺序）
export const QUOTE_METAS: QuoteMeta[] = [
  {
    instrumentId: "xau-cny",
    name: "人民币理论金价",
    shortName: "理论金价",
    unit: "元/克",
    hint: "伦敦金价 × 美元兑人民币 ÷ 31.1035，理论换算值，非任何交易所成交价。",
  },
  {
    instrumentId: "xau-usd",
    name: "伦敦金（现货黄金）",
    shortName: "伦敦金",
    unit: "美元/盎司",
    hint: "国际现货黄金 XAU/USD，全球金价的锚。",
  },
  {
    instrumentId: "usd-cny",
    name: "美元兑人民币",
    shortName: "美元汇率",
    unit: "",
    hint: "在岸人民币汇率，影响人民币金价换算。",
  },
];

// 二级快捷指标（SGE 现货 / 沪金主力）
export const QUICK_METAS: QuoteMeta[] = [
  {
    instrumentId: "sge-au9999",
    name: "Au99.99（上海金现货）",
    shortName: "Au99.99",
    unit: "元/克",
    hint: "上海黄金交易所现货，国内实物金的基准。",
  },
  {
    instrumentId: "sge-autd",
    name: "Au(T+D)（黄金延期）",
    shortName: "Au(T+D)",
    unit: "元/克",
    hint: "上海黄金交易所延期合约，带杠杆，波动更大。",
  },
  {
    instrumentId: "shfe-au-main",
    name: "沪金主力（上期所期货）",
    shortName: "沪金主力",
    unit: "元/克",
    hint: "上海期货交易所黄金主力合约。",
  },
];

export function metaFor(instrumentId: string): QuoteMeta | undefined {
  return [...QUOTE_METAS, ...QUICK_METAS].find((m) => m.instrumentId === instrumentId);
}

export function fmtPrice(price: number | undefined, digits = 2): string {
  if (price === undefined || !Number.isFinite(price)) return "--";
  return price.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export type ChangeView = { text: string; up: boolean } | null;

// 涨跌展示（红涨绿跌）。无 change/changePercent 返回 null。
export function changeView(quote?: Quote): ChangeView {
  if (!quote) return null;
  const hasPct = quote.changePercent !== undefined && Number.isFinite(quote.changePercent);
  const hasAmt = quote.change !== undefined && Number.isFinite(quote.change);
  if (!hasPct && !hasAmt) return null;

  const basis = quote.changePercent ?? quote.change ?? 0;
  const up = basis >= 0;
  const sign = up ? "+" : "";
  const amt = hasAmt ? `${sign}${quote.change!.toFixed(2)}` : "";
  const pct = hasPct ? `${sign}${quote.changePercent!.toFixed(2)}%` : "";
  const text = amt && pct ? `${amt} (${pct})` : amt || pct;
  return { text, up };
}

// 红涨绿跌的 Tailwind class
export function changeColorClass(up: boolean): string {
  return up ? "text-rose-400" : "text-emerald-400";
}

// 时间戳归一化展示（HH:MM:SS）。多源格式混杂，尽量解析；失败原样返回。
export function fmtTime(timestamp?: string): string {
  if (!timestamp) return "--";
  const normalized = timestamp.includes("T") ? timestamp : timestamp.replace(/\//g, "-");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return timestamp;
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// 积存金来源徽章文案 + 颜色
export function bankSourceBadge(source?: string): { label: string; cls: string } {
  if (!source) return { label: "估算", cls: "text-slate-500" };
  if (source.includes("工商银行官网") || source.includes("建设银行官网"))
    return { label: "官网直连", cls: "text-emerald-400" };
  if (source.includes("京东积存金")) return { label: "京东平台", cls: "text-emerald-400" };
  if (source.includes("汇喵")) return { label: "第三方聚合", cls: "text-sky-300" };
  return { label: "估算", cls: "text-slate-500" };
}

export function isBankReal(source?: string): boolean {
  if (!source) return false;
  return (
    source.includes("工商银行官网") ||
    source.includes("建设银行官网") ||
    source.includes("京东积存金") ||
    source.includes("汇喵")
  );
}
