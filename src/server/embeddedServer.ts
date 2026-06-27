// 内嵌 Node 数据服务（nodejs-mobile 在 App 内运行的核心逻辑）。
//
// 复用 src/lib 数据层（算法不分叉），对外提供两组能力：
//   1. payload 构造函数（buildQuotes/buildBankGold/buildHistory）——纯逻辑，IPC 入口与 HTTP 都用。
//   2. createServer()/start()——原生 node:http 服务（HTTP 兑底：web 调试 / 局域网 / Termux）。
// 真正的 App 形态由 nodejsEntry.ts 经 bridge channel 走 IPC 调这些 payload 函数（主链路）。
//
// 为什么数据层必须在 Node 里：新浪要伪造 Referer（forbidden header）+GB18030 解码；
// 工行/建行官网用老旧 TLS，必须 node:https + crypto.SSL_OP_LEGACY_SERVER_CONNECT；多处自定义 UA。
// 这些只有真正的 Node 运行时能做，故把数据层放进内嵌 Node。
//
// 诚实：本服务仍需联网抓取上游；「数据闭环」指不依赖自建云服务器，不是离线可用。

import http from "node:http";
import { getQuotes } from "../lib/quotes";
import { fetchBankGoldQuotes } from "../lib/bankGold";
import { fetchHistory, type HistoryPayload } from "../lib/history";
import { subscribe } from "../lib/streamManager";
import type { QuotesPayload, BankGoldPayload } from "../lib/types";

export const HOST = "127.0.0.1";
export const PORT = 3100;

// ── payload 构造（IPC 与 HTTP 共用，永不抛裸异常，失败也返回结构化空数据 + 警告） ──────

/** 行情快照（新浪 + Gold-API + 计算）。 */
export async function buildQuotes(): Promise<QuotesPayload> {
  try {
    const { quotes, warnings } = await getQuotes();
    return { quotes, warnings, serverTime: Date.now() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { quotes: [], warnings: [`行情抓取失败：${message}`], serverTime: Date.now() };
  }
}

/** 银行积存金对比（先抓行情取基准价，再抓各行报价）。 */
export async function buildBankGold(): Promise<BankGoldPayload> {
  try {
    const { quotes } = await getQuotes();
    const sgeAu = quotes.find((q) => q.instrumentId === "sge-au9999")?.price;
    const xauCny = quotes.find((q) => q.instrumentId === "xau-cny")?.price;

    const { quotes: bankQuotes, realCount } = await fetchBankGoldQuotes(sgeAu, xauCny);

    const warnings: string[] = [];
    if (realCount === 0) {
      warnings.push("当前所有银行报价均来自估算兜底，未取到真实直连数据");
    }
    return {
      quotes: bankQuotes,
      realCount,
      total: bankQuotes.length,
      warnings,
      serverTime: Date.now(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return {
      quotes: [],
      realCount: 0,
      total: 0,
      warnings: [`积存金抓取失败：${message}`],
      serverTime: Date.now(),
    };
  }
}

/** 趋势图历史分时（伦敦金当日分时 + 人民币理论分时）。 */
export async function buildHistory(): Promise<HistoryPayload> {
  try {
    return await fetchHistory();
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return { series: {}, sources: { error: message } };
  }
}

// ── HTTP 兑底服务（原生 node:http） ─────────────────────────────────────────────

/** 统一 JSON 响应（no-store + CORS 放开，供 WebView 跨源取数兑底）。 */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

// SSE：复用 streamManager 的 subscribe，每帧经 res.write 推送；15s 心跳保活。
function handleStream(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });

  const send = (data: unknown): void => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* 连接已关闭 */
    }
  };
  const unsubscribe = subscribe((payload) => send(payload));
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* 已关闭 */
    }
  }, 15000);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

/** 创建 HTTP 服务（不自动 listen）。 */
export function createServer(): http.Server {
  return http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
      });
      res.end();
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method Not Allowed" });
      return;
    }

    const path = (req.url ?? "").split("?")[0];
    switch (path) {
      case "/api/quotes":
        void buildQuotes().then((p) => sendJson(res, 200, p));
        return;
      case "/api/bank-gold":
        void buildBankGold().then((p) => sendJson(res, 200, p));
        return;
      case "/api/history":
        void buildHistory().then((p) => sendJson(res, 200, p));
        return;
      case "/api/stream":
        handleStream(req, res);
        return;
      case "/":
      case "/health":
        sendJson(res, 200, { ok: true, service: "gold-embedded-node", port: PORT });
        return;
      default:
        sendJson(res, 404, { error: "Not Found", path });
        return;
    }
  });
}

/** 启动 HTTP 服务，监听 127.0.0.1:3100。返回 server 句柄。 */
export function start(): http.Server {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`[gold] embedded node http listening on http://${HOST}:${PORT}`);
  });
  return server;
}
