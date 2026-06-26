// 工商银行积存金官网直连（PhoneApp 独立实现）。
// 数据源：https://mybank.icbc.com.cn/.../goldaccrual_query_out.jsp（公开页，GBK）。
// ⚠️ TLS：ICBC 站用老旧 TLS（需 legacy renegotiation），全局 fetch/undici 无法配置，
//    必须 node:https + SSL_OP_LEGACY_SERVER_CONNECT 才能握手。
// ⚠️ 不取 sellprice：实测 activeprice===sellprice，该页不暴露真实点差；设 bid 会伪造 0 点差。

import https from "node:https";
import crypto from "node:crypto";
import type { Quote } from "./types";

const ICBC_GOLD_URL =
  "https://mybank.icbc.com.cn/icbc/newperbank/perbank3/gold/goldaccrual_query_out.jsp";

const ICBC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PRODUCT_CODE = "080020000521"; // 工行积存金产品码（td id 后缀）

const icbcAgent = new https.Agent({
  rejectUnauthorized: false,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT as number,
});

function extractField(html: string, field: string): number | null {
  const re = new RegExp(`id="${field}_${PRODUCT_CODE}"[^>]*>([^<]+)`, "i");
  const m = html.match(re);
  if (!m) return null;
  const v = Number(m[1].trim());
  return Number.isFinite(v) && v > 0 ? v : null;
}

function httpsGet(url: string, headers: Record<string, string>, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: icbcAgent, headers, timeout: timeoutMs }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

export async function fetchIcbcAccrualQuote(): Promise<Quote | null> {
  try {
    const buf = await httpsGet(ICBC_GOLD_URL, { "User-Agent": ICBC_UA, Accept: "text/html" }, 8000);

    let html: string;
    try {
      html = new TextDecoder("gbk").decode(buf);
    } catch {
      html = buf.toString("utf8");
    }

    const active = extractField(html, "activeprice"); // 主动积存价(你买入)
    const high = extractField(html, "highprice");
    const low = extractField(html, "lowprice");
    if (!active) return null;

    const now = new Date().toLocaleString("zh-CN");
    const r2 = (n: number) => Math.round(n * 100) / 100;

    return {
      instrumentId: "icbc-acc-gold",
      price: r2(active),
      ask: r2(active),
      bid: undefined, // 故意不设：见文件头
      dayHigh: high != null ? r2(high) : undefined,
      dayLow: low != null ? r2(low) : undefined,
      change: undefined,
      changePercent: undefined,
      timestamp: now,
      source: "工商银行官网·积存金实时牌价",
      stale: false,
    };
  } catch (e) {
    console.warn("[bankGold] 工行官网直连失败，回退 huimiao:", e);
    return null;
  }
}
