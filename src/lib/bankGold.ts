// 银行积存金真实数据（PhoneApp 独立实现）。
//
// 数据源优先级（每家银行选最佳源）：
//   1. 工行/建行官网直连（实时牌价，失败回退 huimiao）
//   2. 汇喵 huimiao API（中行/招行/兴业；工建作回退）
//   3. 京东积存金平台 API（民生 v1 / 浙商 v2 / 广发经 huimiao-JD）
//   4. 基于 SGE Au99.99 真实价 + 银行已知点差【估算】兜底
//
// ⚠️ 诚实：真实/估算只靠 source 子串区分（含「官网」「汇喵」「京东积存金」=真实）。
// ⚠️ huimiao 字段名反直觉：purchase_value=你买入价(price/ask)，sale_value=你卖出价(bid)。
// ⚠️ 京东只给单边价（卖出），bid 用全点差估算（sell 边真实、buy 边估算）。

import type { Quote, BankDirectDiag } from "./types";
import { BANK_GOLD_PRODUCTS, type ProductDef } from "./bankProducts";
import { fetchIcbcAccrualQuote, type IcbcResult } from "./icbcDirect";
import { fetchCcbAccrualQuote, type CcbResult } from "./ccbDirect";

// 产品清单已抽到 ./bankProducts（纯数据，零 node:* 依赖），供客户端组件复用。
export { BANK_GOLD_PRODUCTS };

// ==================== 请求头 ====================

const HUIMIAO_BASE = "https://www.zhengmeili.asia/ec/skill/gateway";

const JDJR_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 JDFinance/7.25.0",
  Accept: "application/json",
  "Accept-Language": "zh-CN,zh;q=0.9",
  Referer: "https://jdjr.jd.com/",
  Origin: "https://jdjr.jd.com",
};

const HUIMIAO_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
};

// ==================== 类型 ====================

interface HuimiaoRateResponse {
  success?: boolean;
  bank_type?: string;
  currency_type?: string;
  purchase_value?: number;
  sale_value?: number;
}

interface JdjrResponse {
  success?: boolean;
  resultCode?: number;
  resultData?: {
    datas?: {
      price?: string;
      yesterdayPrice?: string;
      upAndDownAmt?: string;
      upAndDownRate?: string;
      time?: string;
    };
    status?: string;
  };
  resultMsg?: string;
}

// ==================== 主入口 ====================

export async function fetchBankGoldQuotes(
  sgeAu9999Price: number | undefined,
  xauCnyPrice: number | undefined,
): Promise<{
  quotes: Quote[];
  realCount: number;
  bankDirectDiag: { icbc: BankDirectDiag; ccb: BankDirectDiag };
}> {
  const quotes: Quote[] = [];

  const [huimiaoQuotes, jdjrQuotes, icbcDirectQuote, ccbDirectQuote] = await Promise.allSettled([
    fetchHuimiaoQuotes(),
    fetchJdjrRealQuotes(),
    fetchIcbcAccrualQuote(),
    fetchCcbAccrualQuote(),
  ]);

  const huimiaoData = huimiaoQuotes.status === "fulfilled" ? huimiaoQuotes.value : [];
  const jdjrData = jdjrQuotes.status === "fulfilled" ? jdjrQuotes.value : [];
  // v0.1.12：两行 fetch 改为返回 {quote, diag}，diag 随本次调用带出（无模块级单例竞态）。
  // allSettled 若整个 reject（极少见），diag 退化为通用错误码。
  const icbcResult: IcbcResult =
    icbcDirectQuote.status === "fulfilled"
      ? icbcDirectQuote.value
      : { quote: null, diag: { code: "rejected" } };
  const ccbResult: CcbResult =
    ccbDirectQuote.status === "fulfilled"
      ? ccbDirectQuote.value
      : { quote: null, diag: { code: "rejected" } };
  const icbcDirect = icbcResult.quote;
  const ccbDirect = ccbResult.quote;

  for (const product of BANK_GOLD_PRODUCTS) {
    if (product.instrumentId === "icbc-acc-gold" && icbcDirect) {
      quotes.push(icbcDirect);
      continue;
    }
    if (product.instrumentId === "ccb-acc-gold" && ccbDirect) {
      quotes.push(ccbDirect);
      continue;
    }

    const huimiaoQuote = huimiaoData.find((q) => q.instrumentId === product.instrumentId);
    const jdjrQuote = jdjrData.find((q) => q.instrumentId === product.instrumentId);

    if (huimiaoQuote) {
      quotes.push(huimiaoQuote);
    } else if (jdjrQuote) {
      quotes.push(jdjrQuote);
    } else {
      // 兜底估算（明确标注，绝不冒充真实）
      const basePrice = sgeAu9999Price || xauCnyPrice;
      if (basePrice && basePrice > 0) {
        const spreads = product.spreadFallback;
        const now = new Date().toLocaleString("zh-CN");
        const sellPrice = basePrice + spreads.sellSpread;
        const buyPrice = basePrice - spreads.buySpread;
        const baseSource = sgeAu9999Price
          ? "基于SGE Au99.99真实价+银行点差估算"
          : "基于XAU/CNY理论价+银行点差估算";
        quotes.push({
          instrumentId: product.instrumentId,
          price: Math.round(sellPrice * 100) / 100,
          bid: Math.round(buyPrice * 100) / 100,
          ask: Math.round(sellPrice * 100) / 100,
          timestamp: now,
          source: `${baseSource} · ${product.bankName}${product.product}`,
          stale: false,
        });
      }
    }
  }

  const realCount = quotes.filter((q) => isRealSource(q.source)).length;
  console.log(`[bankGold] ✅ 获取 ${quotes.length} 个银行数据，其中 ${realCount} 个真实数据`);

  // 官网直连诊断（成败原因 + 设备实收证据）：取本次调用各自返回的 diag，随 payload 透出。
  const bankDirectDiag = { icbc: icbcResult.diag, ccb: ccbResult.diag };
  return { quotes, realCount, bankDirectDiag };
}

export function isRealSource(source: string): boolean {
  return (
    source.includes("汇喵") ||
    source.includes("京东积存金") ||
    source.includes("工商银行官网") ||
    source.includes("建设银行官网")
  );
}

// ==================== 汇喵 API ====================

async function fetchHuimiaoQuotes(): Promise<Quote[]> {
  const quotes: Quote[] = [];
  const products = BANK_GOLD_PRODUCTS.filter((p) => p.huimiaoBankType && p.huimiaoCurrencyType);
  await Promise.allSettled(
    products.map((product) =>
      fetchHuimiaoProduct(product).then((quote) => {
        if (quote) quotes.push(quote);
      }),
    ),
  );
  return quotes;
}

async function fetchHuimiaoProduct(product: ProductDef): Promise<Quote | null> {
  if (!product.huimiaoBankType || !product.huimiaoCurrencyType) return null;
  try {
    const url = `${HUIMIAO_BASE}?type=rates_latest&currency_type=${product.huimiaoCurrencyType}&bank_type=${product.huimiaoBankType}`;
    const res = await fetch(url, {
      headers: HUIMIAO_HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HuimiaoRateResponse;
    if (!data.success || !data.purchase_value || !data.sale_value) return null;

    const purchaseValue = Number(data.purchase_value); // 你买入价
    const saleValue = Number(data.sale_value); // 你卖出价
    if (!Number.isFinite(purchaseValue) || !Number.isFinite(saleValue)) return null;

    const now = new Date().toLocaleString("zh-CN");
    const spread = purchaseValue - saleValue;
    return {
      instrumentId: product.instrumentId,
      price: Math.round(purchaseValue * 100) / 100,
      bid: Math.round(saleValue * 100) / 100,
      ask: Math.round(purchaseValue * 100) / 100,
      timestamp: now,
      source: `汇喵金融实时数据 · ${product.bankName}${product.product}（点差¥${spread.toFixed(2)}）`,
      stale: false,
    };
  } catch (e) {
    console.warn(`[bankGold] 汇喵 ${product.bankName} 请求失败:`, e);
    return null;
  }
}

// ==================== 京东积存金平台 API ====================

async function fetchJdjrRealQuotes(): Promise<Quote[]> {
  const quotes: Quote[] = [];
  const products = BANK_GOLD_PRODUCTS.filter((p) => p.jdjrSku || p.jdjrName);
  await Promise.allSettled(
    products.map((product) =>
      fetchJdjrProduct(product).then((quote) => {
        if (quote) quotes.push(quote);
      }),
    ),
  );
  return quotes;
}

async function fetchJdjrProduct(product: ProductDef): Promise<Quote | null> {
  try {
    let url: string;
    if (product.jdjrApi === "v1" && product.jdjrSku) {
      url = `https://api.jdjygold.com/gw/generic/hj/h5/m/latestPrice`;
    } else if (product.jdjrSku) {
      url = `https://api.jdjygold.com/gw2/generic/jrm/h5/m/stdLatestPrice?productSku=${product.jdjrSku}`;
    } else if (product.jdjrName) {
      return fetchHuimiaoJdProduct(product);
    } else {
      return null;
    }

    const res = await fetch(url, {
      headers: JDJR_HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as JdjrResponse;
    if (!data.success || data.resultCode !== 0) return null;

    const datas = data.resultData?.datas;
    if (!datas?.price) return null;

    const price = parseFloat(datas.price);
    const changeRateStr = datas.upAndDownRate?.replace("%", "") ?? null;
    const changePercent = changeRateStr ? parseFloat(changeRateStr) : null;
    const changeAmt = datas.upAndDownAmt ? parseFloat(datas.upAndDownAmt) : null;
    const timestamp = datas.time
      ? new Date(Number(datas.time)).toLocaleString("zh-CN")
      : new Date().toLocaleString("zh-CN");
    if (!Number.isFinite(price) || price <= 0) return null;

    // 京东只给单边（卖出）价；买入价用全点差估算
    const spreads = product.spreadFallback;
    const buyPrice = price - (spreads.sellSpread + spreads.buySpread);

    return {
      instrumentId: product.instrumentId,
      price: Math.round(price * 100) / 100,
      bid: Math.round(buyPrice * 100) / 100,
      ask: Math.round(price * 100) / 100,
      change: changeAmt ?? undefined,
      changePercent:
        changePercent !== null && Number.isFinite(changePercent) ? changePercent : undefined,
      timestamp,
      source: `京东积存金实时数据 · ${product.bankName}${product.product}`,
      stale: false,
    };
  } catch (e) {
    console.warn(`[bankGold] 京东 ${product.bankName} 请求失败:`, e);
    return null;
  }
}

async function fetchHuimiaoJdProduct(product: ProductDef): Promise<Quote | null> {
  if (!product.jdjrName) return null;
  try {
    const url = `${HUIMIAO_BASE}?type=rates_latest&currency_type=${encodeURIComponent(product.jdjrName)}&bank_type=JD`;
    const res = await fetch(url, {
      headers: HUIMIAO_HEADERS,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HuimiaoRateResponse;
    if (!data.success || !data.purchase_value) return null;

    const purchaseValue = Number(data.purchase_value);
    const saleValue = data.sale_value ? Number(data.sale_value) : null;
    if (!Number.isFinite(purchaseValue)) return null;

    const now = new Date().toLocaleString("zh-CN");
    return {
      instrumentId: product.instrumentId,
      price: Math.round(purchaseValue * 100) / 100,
      bid: saleValue && Number.isFinite(saleValue) ? Math.round(saleValue * 100) / 100 : undefined,
      ask: Math.round(purchaseValue * 100) / 100,
      timestamp: now,
      source: `京东积存金实时数据 · ${product.bankName}${product.product}`,
      stale: false,
    };
  } catch {
    return null;
  }
}
