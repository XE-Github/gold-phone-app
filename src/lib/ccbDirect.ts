// 建设银行积存金官网直连（PhoneApp 独立实现）。
// 两步流程：① TXCODE=100119 取 session cookie ② TXCODE=NGJS01 带 cookie 拿 JSON 报价。
// ⚠️ 同 ICBC 的老旧 TLS：必须 node:https + SSL_OP_LEGACY_SERVER_CONNECT。
// 字段：Cst_Buy_Prc=客户买入价(你买)→price/ask；Cst_Sell_Prc=客户卖出价(你卖)→bid。

import https from "node:https";
import crypto from "node:crypto";
import type { Quote } from "./types";

const CCB_BASE = "https://gold3.ccb.com";
const CCB_REFERER = `${CCB_BASE}/chn/home/gold_new/cpjs/index.shtml`;
const CCB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ccbAgent = new https.Agent({
  rejectUnauthorized: false,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT as number,
});

interface CcbNgjs01Response {
  SUCCESS: string;
  PM_Txn_Vrty_Cd?: string;
  CcyCd?: string;
  Cst_Buy_Prc?: string;
  MdlRate?: string;
  Cst_Sell_Prc?: string;
  Tms?: string;
}

function httpsGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: ccbAgent, headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

export async function fetchCcbAccrualQuote(): Promise<Quote | null> {
  try {
    const sessUrl = `${CCB_BASE}/tran/WCCMainPlatV5?CCB_IBSVersion=V5&SERVLET_NAME=WCCMainPlatV5&TXCODE=100119`;
    const r1 = await httpsGet(sessUrl, { "User-Agent": CCB_UA, Referer: CCB_REFERER }, 8000);
    const setCookies = Array.isArray(r1.headers["set-cookie"])
      ? (r1.headers["set-cookie"] as string[])
      : r1.headers["set-cookie"]
        ? [r1.headers["set-cookie"] as string]
        : [];
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookieHeader) return null;

    const priceUrl = `${CCB_BASE}/tran/WCCMainPlatV5?CCB_IBSVersion=V5&SERVLET_NAME=WCCMainPlatV5&TXCODE=NGJS01`;
    const r2 = await httpsGet(
      priceUrl,
      { "User-Agent": CCB_UA, Referer: CCB_REFERER, Cookie: cookieHeader },
      8000,
    );

    const data = JSON.parse(r2.body.trim()) as CcbNgjs01Response;
    if (data.SUCCESS !== "true") return null;

    const buy = Number(data.Cst_Buy_Prc);
    const sell = Number(data.Cst_Sell_Prc);
    if (!Number.isFinite(buy) || buy <= 0) return null;

    const now = new Date().toLocaleString("zh-CN");
    const r2f = (n: number) => Math.round(n * 100) / 100;

    return {
      instrumentId: "ccb-acc-gold",
      price: r2f(buy),
      ask: r2f(buy),
      bid: Number.isFinite(sell) && sell > 0 ? r2f(sell) : undefined,
      change: undefined,
      changePercent: undefined,
      timestamp: data.Tms || now,
      source: "建设银行官网·积存金实时牌价",
      stale: false,
    };
  } catch (e) {
    console.warn("[bankGold] 建行官网直连失败，回退 huimiao:", e);
    return null;
  }
}
