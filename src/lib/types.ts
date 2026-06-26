// PhoneApp 独立数据层类型定义。与主项目互不引用（仅形态相似，便于理解）。
// 诚实原则：instrumentId/price/timestamp/source 必填；bid/ask/change/dayHigh/dayLow
// 只有数据源【真实提供】时才填，绝不臆造。

export type Quote = {
  instrumentId: string;
  price: number;
  bid?: number;
  ask?: number;
  change?: number;
  changePercent?: number;
  dayHigh?: number;
  dayLow?: number;
  timestamp: string; // 格式不统一：新浪带 +08:00、银行用 toLocaleString("zh-CN")、Gold-API 用 ISO
  source: string; // 载体字段：积存金真实/估算由 source 子串判定
  stale?: boolean;
};

// 手机看板要展示的行情标的元数据（纯展示用）
export type QuoteMeta = {
  instrumentId: string;
  name: string;
  shortName: string;
  unit: string; // 元/克、美元/盎司、点 等
  hint?: string; // 给小白的一句话解释
};

// 单家银行积存金产品元数据
export type BankGoldProduct = {
  instrumentId: string;
  bankName: string;
  product: string;
  spreadNote?: string;
  minTradeAmount?: string;
  tradingHours?: string;
};

export type QuotesPayload = {
  quotes: Quote[];
  warnings: string[];
  serverTime: number;
  bankRealCount?: number; // 积存金真实数据条数（SSE 合并推送/降级轮询带，行情快照不带）
  bankTotal?: number; // 积存金标的总数
};

export type BankGoldPayload = {
  quotes: Quote[];
  realCount: number;
  total: number;
  warnings: string[];
  serverTime: number;
};
