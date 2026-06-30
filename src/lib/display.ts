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
  // 黄金 ETF（基金份额，非 SGE 现货；单价约 8 元/份，跟踪国内金价）
  {
    instrumentId: "gold-etf-518880",
    name: "黄金ETF（518880·华安）",
    shortName: "518880 ETF",
    unit: "元/份",
    hint: "华安黄金ETF，沪市场内交易基金，跟踪国内黄金价格。",
  },
];

// 价格提醒可选标的（与主程序对齐）。含行情标的 + 8 家银行积存金。
// 注：xau-cny 为理论换算价、银行积存金为牌价，均可设价格提醒。
export const ALERT_METAS: QuoteMeta[] = [
  { instrumentId: "xau-cny", name: "人民币理论金价", shortName: "人民币理论金价", unit: "元/克" },
  { instrumentId: "xau-usd", name: "伦敦金 XAU/USD", shortName: "伦敦金", unit: "美元/盎司" },
  { instrumentId: "usd-cny", name: "美元兑人民币", shortName: "美元汇率", unit: "" },
  { instrumentId: "sge-au9999", name: "SGE Au99.99", shortName: "Au99.99", unit: "元/克" },
  { instrumentId: "sge-autd", name: "SGE Au(T+D)", shortName: "Au(T+D)", unit: "元/克" },
  { instrumentId: "shfe-au-main", name: "沪金主力", shortName: "沪金主力", unit: "元/克" },
  // 积存金提醒选项与 BANK_GOLD_PRODUCTS 对齐，仅 5 家（顺序：工商→浙商→民生→广发→建设）
  { instrumentId: "icbc-acc-gold", name: "工商银行积存金", shortName: "工行积存金", unit: "元/克" },
  { instrumentId: "czbank-acc-gold", name: "浙商银行积存金", shortName: "浙商积存金", unit: "元/克" },
  { instrumentId: "cmbc-acc-gold", name: "民生银行积存金", shortName: "民生积存金", unit: "元/克" },
  { instrumentId: "cgb-acc-gold", name: "广发银行积存金", shortName: "广发积存金", unit: "元/克" },
  { instrumentId: "ccb-acc-gold", name: "建设银行积存金", shortName: "建行积存金", unit: "元/克" },
];

export function metaFor(instrumentId: string): QuoteMeta | undefined {
  return [...QUOTE_METAS, ...QUICK_METAS, ...ALERT_METAS].find(
    (m) => m.instrumentId === instrumentId,
  );
}

export function fmtPrice(price: number | undefined, digits = 2): string {
  if (price === undefined || !Number.isFinite(price)) return "--";
  return price.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// 计价货币符号：按 meta.unit 判定（unit 是单一事实源，新标的填对 unit 即自动正确）。
// ⚠️ 必须先判"美元"——它本身含"元"，顺序反了会把美元标的标成 ¥。
export function currencySymbol(unit?: string): "¥" | "$" | "" {
  if (!unit) return "";
  if (unit.includes("美元")) return "$";
  if (unit.includes("元")) return "¥";
  return "";
}

export function currencySymbolForId(id: string): "¥" | "$" | "" {
  return currencySymbol(metaFor(id)?.unit);
}

export type ChangeView = { text: string; up: boolean } | null;

// 涨跌展示（红涨绿跌）。无 change/changePercent 返回 null。
// symbol：涨跌额的计价货币符号（¥/$/""），插在正负号与数字之间，如 "+¥2.85"；百分比不带符号。
export function changeView(quote?: Quote, symbol = ""): ChangeView {
  if (!quote) return null;
  const hasPct = quote.changePercent !== undefined && Number.isFinite(quote.changePercent);
  const hasAmt = quote.change !== undefined && Number.isFinite(quote.change);
  if (!hasPct && !hasAmt) return null;

  const basis = quote.changePercent ?? quote.change ?? 0;
  const up = basis >= 0;
  const sign = up ? "+" : "";
  const amt = hasAmt ? `${sign}${symbol}${quote.change!.toFixed(2)}` : "";
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

// 行情数据「时效性」徽章：实时 / 近实时 / 延时 / 理论值 / 估算。
// 诚实原则：只依据 source 子串判定，绝不臆造。
export type Freshness = { label: string; cls: string; dot: string };
export function freshnessBadge(source?: string): Freshness {
  const s = source ?? "";
  if (s.includes("自动计算") || s.includes("理论"))
    return { label: "理论值", cls: "text-amber-300", dot: "bg-amber-400" };
  if (s.includes("估算"))
    return { label: "估算", cls: "text-slate-400", dot: "bg-slate-500" };
  if (s.includes("秒级") || s.includes("近实时"))
    return { label: "近实时", cls: "text-emerald-300", dot: "bg-emerald-400" };
  if (s.includes("实时"))
    return { label: "实时", cls: "text-emerald-300", dot: "bg-emerald-400" };
  if (s.includes("延时"))
    return { label: "延时", cls: "text-amber-300", dot: "bg-amber-400" };
  // 其余真实源（官网/京东/汇喵牌价等）视为最新牌价
  if (s.includes("官网") || s.includes("京东") || s.includes("汇喵"))
    return { label: "最新牌价", cls: "text-emerald-300", dot: "bg-emerald-400" };
  return { label: "—", cls: "text-slate-500", dot: "bg-slate-600" };
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
