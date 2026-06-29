// 工商银行积存金官网直连（PhoneApp 独立实现）。
// 数据源：https://mybank.icbc.com.cn/.../goldaccrual_query_out.jsp（公开页，GBK）。
// ⚠️ TLS：ICBC 站用老旧 TLS（需 legacy renegotiation），全局 fetch/undici 无法配置，
//    必须 node:https + SSL_OP_LEGACY_SERVER_CONNECT 才能握手。
// ⚠️ GBK 解码必须用 iconv-lite，不能用 new TextDecoder("gbk")：内嵌 nodejs-mobile(Node18)
//    是 small-icu，不含 gbk legacy 编码表 → 设备上 TextDecoder('gbk') 抛 RangeError
//    （同 sina.ts 的 gb18030 坑）。iconv-lite 纯 JS、可被 esbuild 打进 main.js。
// ⚠️ 不取 sellprice：实测 activeprice===sellprice，该页不暴露真实点差；设 bid 会伪造 0 点差。

import https from "node:https";
import crypto from "node:crypto";
import iconv from "iconv-lite";
import type { Quote, BankDirectDiag } from "./types";

const ICBC_GOLD_URL =
  "https://mybank.icbc.com.cn/icbc/newperbank/perbank3/gold/goldaccrual_query_out.jsp";

const ICBC_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PRODUCT_CODE = "080020000521"; // 工行积存金产品码（td id 后缀）

const icbcAgent = new https.Agent({
  rejectUnauthorized: false,
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT as number,
});

// 直连诊断：结论 + 失败时设备「实际收到了什么」的取证（见 types.BankDirectDiag）。
// ⚠️ v0.1.12 改为随返回值带出（IcbcResult.diag），不再用模块级单例：
//   设备上 streamManager 定时 refreshBank 与诊断页 probe 会并发调本函数，
//   try 顶若重置共享单例为 {code:"ok"}，另一路读到的就是被覆盖的 ok（无证据字段），
//   表现为诊断页恒显「连上但无有效数据」却没有任何实收证据——这正是 v0.1.11 真机报告的假象。
//   每次调用各自返回自己的 diag，彻底无竞态。
export type IcbcResult = { quote: Quote | null; diag: BankDirectDiag };

// 从异常提炼简短诊断码：网络层错误有 e.code（最有用）；HTTP 状态错误 message 以 "HTTP " 开头。
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

// 截响应体前若干可见字符，压成单行，供诊断定位「是不是挑战页/报错页」。
// 只在失败路径调用、只截公开查询页 HTML/JSON 头部，不含鉴权或个人数据。
function safeSnippet(text: string, max = 120): string {
  return String(text).replace(/\s+/g, " ").trim().slice(0, max);
}

function extractField(html: string, field: string): number | null {
  const re = new RegExp(`id="${field}_${PRODUCT_CODE}"[^>]*>([^<]+)`, "i");
  const m = html.match(re);
  if (!m) return null;
  const v = Number(m[1].trim());
  return Number.isFinite(v) && v > 0 ? v : null;
}

// 返回完整响应（含 status/headers），HTTP≥400 不再 reject —— 调用处据 status 记录取证再决定。
// 仅网络层错误（EPROTO/超时/DNS 等）才 reject，那是真握手/连接失败。
type IcbcResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  buf: Buffer;
};

function httpsGet(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<IcbcResponse> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: icbcAgent, headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers as Record<string, string | string[] | undefined>,
          buf: Buffer.concat(chunks),
        }),
      );
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

function headerStr(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

export async function fetchIcbcAccrualQuote(): Promise<IcbcResult> {
  try {
    const res = await httpsGet(
      ICBC_GOLD_URL,
      { "User-Agent": ICBC_UA, Accept: "text/html" },
      8000,
    );

    // 设备实收取证：握手通了才到这里，记下状态/字节/类型/重定向，失败时随 diag 透出。
    const contentType = headerStr(res.headers["content-type"]);
    const location = headerStr(res.headers["location"]);
    const bytes = res.buf.length;

    if (res.status >= 400) {
      return {
        quote: null,
        diag: {
          code: `HTTP ${res.status}`,
          httpStatus: res.status,
          bytes,
          contentType,
          location,
          snippet: safeSnippet(iconv.decode(res.buf, "gbk")),
        },
      };
    }

    // iconv-lite 纯 JS 解 GBK（绕开设备 small-icu 无 gbk 编码表的坑，见文件头注释）。
    const html = iconv.decode(res.buf, "gbk");

    const active = extractField(html, "activeprice"); // 主动积存价(你买入)
    const high = extractField(html, "highprice");
    const low = extractField(html, "lowprice");
    if (!active) {
      // 握手+解码都成，但没解出有效价格：可能页面结构变了，也可能收到的是挑战/重定向页。
      // 带上设备实收证据（状态/字节/类型/重定向/片段）以便看清到底收到了什么。
      return {
        quote: null,
        diag: {
          code: "no-data",
          httpStatus: res.status,
          bytes,
          contentType,
          location,
          snippet: safeSnippet(html),
        },
      };
    }

    const now = new Date().toLocaleString("zh-CN");
    const r2 = (n: number) => Math.round(n * 100) / 100;

    return {
      quote: {
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
      },
      diag: { code: "ok" },
    };
  } catch (e) {
    // 走到 catch = 网络/握手层错误（EPROTO/超时/DNS 等），无 HTTP 状态可记。
    console.warn("[bankGold] 工行官网直连失败，回退 huimiao:", e);
    return { quote: null, diag: { code: diagFromError(e) } };
  }
}
