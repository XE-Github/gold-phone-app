// 新浪财经实时行情（PhoneApp 独立实现）。
// 单次请求 https://hq.sinajs.cn/list=... ，GB18030 解码，Referer 必填（否则被拒）。
// 字段索引经主项目实测校准，关键陷阱见各 parse 函数注释。
//
// ⚠️ 解码必须用 iconv-lite，不能用 new TextDecoder("gb18030")：内嵌运行时
// (@choreruiz/capacitor-node-js 的 nodejs-mobile Node18) 编译用 small-icu，不含
// gb18030 legacy 编码表 → 设备上 TextDecoder('gb18030') 抛 RangeError → 整个
// fetchSinaQuotes reject → 国内标的全无数据(桌面/CI 是 full-icu 故本地测不出)。
// iconv-lite 是纯 JS 解码表、零 ICU 依赖，可被 esbuild 打进 main.js。

import iconv from "iconv-lite";
import type { Quote } from "./types";

// 手机看板只需这几个标的（伦敦金 + 汇率 + SGE 现货 + 沪金主力 + 518880 黄金ETF）
const SINA_SYMBOLS = ["hf_XAU", "hf_XAG", "USDCNY", "gds_AU9999", "gds_AUTD", "nf_AU0", "sh518880"];

const SINA_TO_INSTRUMENT: Record<string, string> = {
  hf_XAU: "xau-usd", // 伦敦金（现货黄金）
  hf_XAG: "xag-usd", // 伦敦银
  USDCNY: "usd-cny", // 美元兑人民币
  gds_AU9999: "sge-au9999", // Au99.99（SGE 现货，秒级真实）
  gds_AUTD: "sge-autd", // Au(T+D)（SGE 延期）
  nf_AU0: "shfe-au-main", // 沪金主力（SHFE 期货）
  sh518880: "gold-etf-518880", // 华安黄金ETF（沪市，元/份）
};

function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "--") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

// 拼装中国时区时间戳（带 +08:00）。缺失则退回 ISO now。
function buildChinaTimestamp(date: string | null, time: string | null): string {
  if (date && time) return `${date}T${time}+08:00`;
  return new Date().toISOString();
}

type Parsed = {
  price: number;
  previous?: number | null;
  dayHigh?: number | null;
  dayLow?: number | null;
  bid?: number | null;
  ask?: number | null;
  timestamp: string;
  sourceOverride?: string;
};

// hf_ 全球期货/现货（hf_XAU 伦敦金、hf_XAG）。dayHigh=4 / dayLow=5 为交易所真实值。
function parseSinaGlobalFuture(fields: string[]): Parsed | null {
  const price = toNumber(fields[0]);
  if (price === null) return null;
  const previous = toNumber(fields[8]) ?? toNumber(fields[1]);
  const dayHigh = toNumber(fields[4]);
  const dayLow = toNumber(fields[5]);
  const time = fields[6] || null; // HH:MM:SS
  const date = fields[12] || null; // YYYY-MM-DD
  return {
    price,
    previous,
    dayHigh,
    dayLow,
    timestamp: buildChinaTimestamp(date, time),
  };
}

// USDCNY 汇率。price 在 idx8（不是 idx2），prev 在 idx1。
function parseSinaFx(fields: string[]): Parsed | null {
  const price = toNumber(fields[8]) ?? toNumber(fields[2]);
  if (price === null) return null;
  const previous = toNumber(fields[1]);
  const time = fields[0] || null;
  const date = fields[10] || null;
  return { price, previous, timestamp: buildChinaTimestamp(date, time) };
}

// nf_ SHFE 沪金主力。⚠️涨跌按【昨结算价 idx10】算，不是昨收 idx5。time idx1=HHMMSS。
function parseSinaCnFuture(fields: string[]): Parsed | null {
  const price = toNumber(fields[8]);
  if (price === null) return null;
  const previous = toNumber(fields[10]) ?? toNumber(fields[5]); // 昨结算优先
  const dayHigh = toNumber(fields[3]);
  const dayLow = toNumber(fields[4]);
  const bid = toNumber(fields[6]);
  const ask = toNumber(fields[7]);
  const rawTime = fields[1] || "";
  const time = rawTime.length === 6
    ? `${rawTime.slice(0, 2)}:${rawTime.slice(2, 4)}:${rawTime.slice(4, 6)}`
    : rawTime || null;
  const date = fields[17] || null;
  return {
    price,
    previous,
    dayHigh,
    dayLow,
    bid,
    ask,
    timestamp: buildChinaTimestamp(date, time),
    sourceOverride: "新浪财经·SHFE沪金主力（实时·真实交易所价）",
  };
}

// gds_ SGE 现货（Au99.99 / Au(T+D)）。需 fields.length>=14。
// idx0=最新 idx4=高 idx5=低 idx6=时间HH:MM:SS idx7=昨收(涨跌基准) idx12=日期。
// idx2/idx3 身份有争议→不当 bid/ask（诚实优先，宁缺勿错）。
function parseSinaSgeSpot(fields: string[]): Parsed | null {
  if (fields.length < 14) return null;
  const price = toNumber(fields[0]);
  if (price === null) return null;
  const previous = toNumber(fields[7]);
  const dayHigh = toNumber(fields[4]);
  const dayLow = toNumber(fields[5]);
  const time = fields[6] || null;
  const date = fields[12] || null;
  return {
    price,
    previous,
    dayHigh,
    dayLow,
    timestamp: buildChinaTimestamp(date, time),
    sourceOverride: "新浪财经·SGE现货（近实时·真实，秒级）",
  };
}

// sh/sz 沪深 A 股/ETF（如 sh518880 华安黄金ETF）。标准股票行布局：
// idx0=名称 idx1=今开 idx2=昨收(涨跌基准) idx3=最新价 idx4=最高 idx5=最低
// …中间是买卖五档量价… 倒数三段 idx30=日期(YYYY-MM-DD) idx31=时间(HH:MM:SS) idx32=状态。
// 字段已用新浪真实接口验证。残缺/非交易时段返回空体由 fetchSinaQuotes 的 !raw 跳过。
function parseSinaCnStock(fields: string[]): Parsed | null {
  if (fields.length < 32) return null;
  const price = toNumber(fields[3]);
  if (price === null) return null;
  const previous = toNumber(fields[2]); // 昨收 = 涨跌基准（交给 buildQuote 算 change）
  const dayHigh = toNumber(fields[4]);
  const dayLow = toNumber(fields[5]);
  const date = fields[30] || null;
  const time = fields[31] || null;
  return {
    price,
    previous,
    dayHigh,
    dayLow,
    timestamp: buildChinaTimestamp(date, time),
    sourceOverride: "新浪财经·沪市ETF（实时）",
  };
}

function dispatch(symbol: string, fields: string[]): Parsed | null {
  if (symbol.startsWith("hf_")) return parseSinaGlobalFuture(fields);
  if (symbol === "USDCNY") return parseSinaFx(fields);
  if (symbol.startsWith("nf_")) return parseSinaCnFuture(fields);
  if (symbol.startsWith("gds_")) return parseSinaSgeSpot(fields);
  if (symbol.startsWith("sh") || symbol.startsWith("sz")) return parseSinaCnStock(fields);
  return null;
}

function buildQuote(symbol: string, parsed: Parsed): Quote {
  const instrumentId = SINA_TO_INSTRUMENT[symbol];
  const quote: Quote = {
    instrumentId,
    price: parsed.price,
    timestamp: parsed.timestamp,
    source: parsed.sourceOverride ?? "新浪财经（实时）",
  };
  if (parsed.previous !== undefined && parsed.previous !== null && parsed.previous !== 0) {
    const change = parsed.price - parsed.previous;
    quote.change = Math.round(change * 1000) / 1000;
    quote.changePercent = Math.round((change / parsed.previous) * 10000) / 100;
  }
  if (parsed.dayHigh !== undefined && parsed.dayHigh !== null) quote.dayHigh = parsed.dayHigh;
  if (parsed.dayLow !== undefined && parsed.dayLow !== null) quote.dayLow = parsed.dayLow;
  if (parsed.bid !== undefined && parsed.bid !== null) quote.bid = parsed.bid;
  if (parsed.ask !== undefined && parsed.ask !== null) quote.ask = parsed.ask;
  return quote;
}

export async function fetchSinaQuotes(): Promise<Quote[]> {
  const url = `https://hq.sinajs.cn/list=${SINA_SYMBOLS.join(",")}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 gold-phone-app/0.1",
      Referer: "https://finance.sina.com.cn", // 必填，否则被拒
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Sina HTTP ${response.status}`);

  const buffer = await response.arrayBuffer();
  // iconv-lite 纯 JS 解 GB18030（绕开 nodejs-mobile small-icu 无 legacy 编码表的坑，见文件头注释）。
  const text = iconv.decode(Buffer.from(buffer), "gb18030");

  const quotes: Quote[] = [];
  for (const match of text.matchAll(/var hq_str_([^=]+)="([^"]*)";/g)) {
    const symbol = match[1];
    const raw = match[2];
    if (!raw) continue;
    if (!(symbol in SINA_TO_INSTRUMENT)) continue;
    const fields = raw.split(",");
    const parsed = dispatch(symbol, fields);
    if (!parsed) continue;
    quotes.push(buildQuote(symbol, parsed));
  }
  return quotes;
}
