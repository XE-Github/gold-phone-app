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
  // ── 每流时效/错误追踪（v0.1.20 加，全可选→向后兼容） ──────────────────────────
  // 诚实原则：晚上上游不更新 / 抓取失败时，前端据此显示「数据可能过时 / 更新失败」，
  // 不再拿旧值假装「●实时」。updatedAt=最后一次【成功】抓取的 Date.now()；error=最后错误信息（成功即清）。
  quotesUpdatedAt?: number; // 行情流最后成功抓取时刻
  bankUpdatedAt?: number; // 积存金流最后成功抓取时刻
  quotesError?: string; // 行情流最后错误（有值=最近一轮抓取失败，仍在用旧数据）
  bankError?: string; // 积存金流最后错误
};

// 工行/建行官网直连诊断证据（v0.1.11 加宽）。code 是简短结论码（ok/no-data/no-cookie/EPROTO/
// HTTP xxx/...），其余字段是失败时设备「实际收到了什么」的取证——握手通了才有 httpStatus/bytes，
// 用于区分「被 WAF 拦/挑战页」「重定向没跟」「空体」等真实成因。snippet 只截公开查询页前若干字符、
// 仅失败路径，不含鉴权/个人数据。仅诊断页消费，主页忽略。
export type BankDirectDiag = {
  code: string;
  httpStatus?: number; // 实际 HTTP 状态码（握手成功才有）
  bytes?: number; // 响应体字节数（0/极小 = 空体或被拦）
  contentType?: string; // Content-Type 头（返回 HTML 而非预期牌价/JSON 即可疑）
  location?: string; // 3xx 时的 Location 头（定位「重定向没跟」）
  snippet?: string; // 响应体前若干字符（单行、脱敏；定位是否为挑战页/报错页）
};

export type BankGoldPayload = {
  quotes: Quote[];
  realCount: number;
  total: number;
  warnings: string[];
  serverTime: number;
  // 时效/错误追踪（v0.1.20 加，可选→向后兼容）：轮询兑底路径 quotesStream 会把这两个
  // 并进合并后的 QuotesPayload.bankUpdatedAt/bankError，与 SSE 流语义一致。
  bankUpdatedAt?: number; // 最后成功抓取时刻
  bankError?: string; // 最后错误（成功即不带）
  // 工行/建行官网直连诊断（见 BankDirectDiag）。仅诊断页消费，主页忽略。
  bankDirectDiag?: { icbc: BankDirectDiag; ccb: BankDirectDiag };
};
