// 建设银行积存金官网直连（PhoneApp 独立实现）。
// 两步流程：① TXCODE=100119 取 session cookie ② TXCODE=NGJS01 带 cookie 拿 JSON 报价。
// ⚠️ 同 ICBC 的老旧 TLS：必须 node:https + SSL_OP_LEGACY_SERVER_CONNECT。
// 字段：Cst_Buy_Prc=客户买入价(你买)→price/ask；Cst_Sell_Prc=客户卖出价(你卖)→bid。

import https from "node:https";
import crypto from "node:crypto";
import type { Quote, BankDirectDiag } from "./types";

const CCB_BASE = "https://gold3.ccb.com";
const CCB_REFERER = `${CCB_BASE}/chn/home/gold_new/cpjs/index.shtml`;
const CCB_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const ccbAgent = new https.Agent({
  rejectUnauthorized: false,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT as number,
});

// 直连诊断：同 icbcDirect（v0.1.11 加宽），记录结论 + 失败时设备实收证据供诊断页显示。
let lastCcbDiag: BankDirectDiag = { code: "ok" };
export function getCcbDirectDiag(): BankDirectDiag {
  return lastCcbDiag;
}

function diagFromError(e: unknown): string {
  const code = (e as { code?: string }).code;
  if (code) return code;
  if (e instanceof Error) {
    if (e.message.startsWith("HTTP ")) return e.message;
    if (e.message === "timeout") return "timeout";
    return e.message || "error";
  }
  return "error";
}

// 截响应体前若干可见字符，压成单行（仅失败路径、公开查询页，不含敏感数据）。
function safeSnippet(text: string, max = 120): string {
  return String(text).replace(/\s+/g, " ").trim().slice(0, max);
}

function headerStr(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

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
  lastCcbDiag = { code: "ok" };
  try {
    const sessUrl = `${CCB_BASE}/tran/WCCMainPlatV5?CCB_IBSVersion=V5&SERVLET_NAME=WCCMainPlatV5&TXCODE=100119`;
    const r1 = await httpsGet(sessUrl, { "User-Agent": CCB_UA, Referer: CCB_REFERER }, 8000);
    const setCookies = Array.isArray(r1.headers["set-cookie"])
      ? (r1.headers["set-cookie"] as string[])
      : r1.headers["set-cookie"]
        ? [r1.headers["set-cookie"] as string]
        : [];
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookieHeader) {
      // 第一步连上了但没拿到 session cookie：带上设备实收证据，看第一步到底返回了什么
      // （挑战页?空体?重定向?）——这是设备最可能卡住的一步。
      lastCcbDiag = {
        code: "no-cookie",
        httpStatus: r1.status,
        bytes: r1.body.length,
        contentType: headerStr(r1.headers["content-type"]),
        location: headerStr(r1.headers["location"]),
        snippet: safeSnippet(r1.body),
      };
      return null;
    }

    const priceUrl = `${CCB_BASE}/tran/WCCMainPlatV5?CCB_IBSVersion=V5&SERVLET_NAME=WCCMainPlatV5&TXCODE=NGJS01`;
    const r2 = await httpsGet(
      priceUrl,
      { "User-Agent": CCB_UA, Referer: CCB_REFERER, Cookie: cookieHeader },
      8000,
    );

    // JSON.parse 包 try：设备若收到非 JSON 的拦截/HTML 页，原来会裸抛进 catch、看不清；
    // 这里直接记 no-data + 片段，把「期望 JSON 却拿到啥」说清楚。
    let data: CcbNgjs01Response;
    try {
      data = JSON.parse(r2.body.trim()) as CcbNgjs01Response;
    } catch {
      lastCcbDiag = {
        code: "no-data",
        httpStatus: r2.status,
        bytes: r2.body.length,
        contentType: headerStr(r2.headers["content-type"]),
        snippet: safeSnippet(r2.body),
      };
      return null;
    }

    if (data.SUCCESS !== "true") {
      lastCcbDiag = {
        code: "no-data",
        httpStatus: r2.status,
        bytes: r2.body.length,
        contentType: headerStr(r2.headers["content-type"]),
        snippet: safeSnippet(r2.body),
      };
      return null;
    }

    const buy = Number(data.Cst_Buy_Prc);
    const sell = Number(data.Cst_Sell_Prc);
    if (!Number.isFinite(buy) || buy <= 0) {
      lastCcbDiag = {
        code: "no-data",
        httpStatus: r2.status,
        bytes: r2.body.length,
        contentType: headerStr(r2.headers["content-type"]),
        snippet: safeSnippet(r2.body),
      };
      return null;
    }

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
    // 网络/握手层错误（EPROTO/超时/DNS 等），无 HTTP 状态可记。
    lastCcbDiag = { code: diagFromError(e) };
    console.warn("[bankGold] 建行官网直连失败，回退 huimiao:", e);
    return null;
  }
}
