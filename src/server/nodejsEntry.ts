// 内嵌 Node 的 IPC 入口（@choreruiz/capacitor-node-js 加载的 main）。
//
// 该插件官方通信是 bridge channel（JSON IPC），非 HTTP。本入口：
//   1. 用 channel 接前端请求（gold:req {id, route}）→ 调 build* → channel.send('gold:res', ...)
//   2. 接前端开/停推流（gold:stream:start / :stop）→ subscribe streamManager → channel.send('gold:stream', payload)
//   3. 同时启动 embeddedServer 的 HTTP 兑底（127.0.0.1:3100），供 web 调试/局域网/异常兑底
//
// 事件名与前端 apiBase 完全一致（IPC_EVENTS），是同一套约定的单一事实来源。
// esbuild 把本文件 + 它 import 的 src/lib/* + embeddedServer 打包成单文件 public/nodejs-project/main.js。
//
// 诚实：bridge 模块由插件在运行时注入（builtin_modules），本仓库不含其实现；
// 本地 tsc 用下方最小类型声明保证类型检查通过，真实行为以装机为准。

import https from "node:https";
import { buildQuotes, buildBankGold, buildHistory, start as startHttp } from "./embeddedServer";
import { subscribe } from "../lib/streamManager";
import { IPC_EVENTS } from "../lib/apiBase";

// bridge 由插件运行时提供（public/builtin_modules/bridge）。本地无其实现，给最小类型。
interface BridgeChannel {
  addListener: (eventName: string, cb: (data: unknown) => void) => void;
  send: (eventName: string, data?: unknown) => void;
}

function getChannel(): BridgeChannel | null {
  try {
    // bridge 是插件运行时注入的内置模块（public/builtin_modules/bridge），不在 node_modules，
    // 故必须用 require 动态取（ESM import 会被 esbuild 当缺失依赖报错）。这是该插件的官方约定用法。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("bridge") as { channel?: BridgeChannel };
    return mod?.channel ?? null;
  } catch {
    return null;
  }
}

type ReqMsg = { id?: number; route?: string };

// 埋点上报：前端经 IPC 把 {endpoint, body} 交给 Node，用 https POST 发出去。
// 走 Node 而非 WebView fetch：绕开 Chromium WebView 的 CORS / UA 丢弃坑（同 OTA 教训）。
// fire-and-forget：失败静默丢弃，无重试队列（本版设计如此），绝不影响主功能。
type TrackMsg = { endpoint?: string; body?: unknown };

function handleTrack(msg: TrackMsg): void {
  try {
    const { endpoint, body } = msg;
    if (typeof endpoint !== "string" || !endpoint || body == null) return;
    const payload = JSON.stringify(body);
    const u = new URL(endpoint);
    if (u.protocol !== "https:") return; // 只发 https，杜绝明文
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent": "gold-phone-app",
        },
        timeout: 8000,
      },
      (res) => {
        res.on("data", () => {}); // 排空响应体，不关心内容
        res.on("end", () => {});
      },
    );
    req.on("error", () => {}); // 网络失败：丢弃这条
    req.on("timeout", () => req.destroy());
    req.write(payload);
    req.end();
  } catch {
    /* 埋点绝不影响主流程 */
  }
}

// 带回执的上报（仅日志反馈）：https POST 到 Worker，缓冲响应体，
// 200 → 回 {ok:true, fid}；任何非 200（含旧 Worker 的 204、502）/超时/网络错 → {ok:false}。
// 「前端拿到 fid」⟺「Worker 已落库」——故必须真读到 200 + {fid} 才算成功。
type TrackReqMsg = { id?: number; endpoint?: string; body?: unknown };

function handleTrackRequest(channel: BridgeChannel, msg: TrackReqMsg): void {
  const { id, endpoint, body } = msg;
  if (typeof id !== "number") return;
  let sent = false; // 每个 id 只回一次回执，否则前端 promise 会卡到自身超时
  const respond = (r: { ok: boolean; fid?: string; error?: string }): void => {
    if (sent) return;
    sent = true;
    try {
      channel.send(IPC_EVENTS.TRACK_RES, { id, ...r });
    } catch {
      /* 通道异常无能为力 */
    }
  };
  try {
    if (typeof endpoint !== "string" || !endpoint || body == null) {
      respond({ ok: false, error: "bad track args" });
      return;
    }
    const payload = JSON.stringify(body);
    const u = new URL(endpoint);
    if (u.protocol !== "https:") {
      respond({ ok: false, error: "not https" });
      return;
    }
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent": "gold-phone-app",
        },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            // 非 200（含旧 Worker 的 204、Worker 502）= 没拿到回执 → 失败，不给编号
            respond({ ok: false, error: `no receipt (HTTP ${res.statusCode ?? "?"})` });
            return;
          }
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { fid?: string };
            if (typeof j.fid === "string" && j.fid) respond({ ok: true, fid: j.fid });
            else respond({ ok: false, error: "no fid in receipt" });
          } catch {
            respond({ ok: false, error: "bad receipt json" });
          }
        });
      },
    );
    req.on("error", (e) => respond({ ok: false, error: String(e) }));
    req.on("timeout", () => {
      req.destroy();
      respond({ ok: false, error: "timeout" });
    });
    req.write(payload);
    req.end();
  } catch (e) {
    respond({ ok: false, error: String(e) });
  }
}

async function handleRequest(channel: BridgeChannel, msg: ReqMsg): Promise<void> {
  const { id, route } = msg;
  if (typeof id !== "number" || typeof route !== "string") return;
  try {
    let data: unknown;
    switch (route) {
      case "/api/quotes":
        data = await buildQuotes();
        break;
      case "/api/bank-gold":
        data = await buildBankGold();
        break;
      case "/api/history":
        data = await buildHistory();
        break;
      default:
        channel.send(IPC_EVENTS.RES, { id, ok: false, error: `未知路由：${route}` });
        return;
    }
    channel.send(IPC_EVENTS.RES, { id, ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    channel.send(IPC_EVENTS.RES, { id, ok: false, error: message });
  }
}

function main(): void {
  // 1) HTTP 兑底服务先起（即使 IPC/channel 不可用，局域网/web 仍可取数）
  try {
    startHttp();
  } catch (e) {
    console.error("[gold] http 兑底启动失败（不影响 IPC）：", e);
  }

  const channel = getChannel();
  if (!channel) {
    // 没有 bridge（非插件环境，如直接 node 跑），仅 HTTP 兑底可用。
    console.warn("[gold] bridge channel 不可用，仅 HTTP 兑底生效");
    return;
  }

  // 2) 请求/响应
  channel.addListener(IPC_EVENTS.REQ, (data) => {
    void handleRequest(channel, (data ?? {}) as ReqMsg);
  });

  // 3) 推流：start 时 subscribe，stop 时取消。多次 start 复用同一订阅。
  let unsubscribe: (() => void) | null = null;
  channel.addListener(IPC_EVENTS.STREAM_START, () => {
    if (unsubscribe) return; // 已在推
    unsubscribe = subscribe((payload) => channel.send(IPC_EVENTS.STREAM, payload));
  });
  channel.addListener(IPC_EVENTS.STREAM_STOP, () => {
    unsubscribe?.();
    unsubscribe = null;
  });

  // 4) 埋点上报（前端→Node→https POST 到 Worker）。单向 fire-and-forget，给 app_open/app_version/ota_action 用。
  channel.addListener(IPC_EVENTS.TRACK, (data) => {
    handleTrack((data ?? {}) as TrackMsg);
  });

  // 4b) 带回执的上报（仅日志反馈）：落库成功后回传云端编号 fid 给前端（gold:track:res）。
  channel.addListener(IPC_EVENTS.TRACK_REQ, (data) => {
    handleTrackRequest(channel, (data ?? {}) as TrackReqMsg);
  });

  // 告知前端 Node 侧已就绪
  channel.send("gold:ready");
  console.log("[gold] embedded node IPC ready");
}

main();
