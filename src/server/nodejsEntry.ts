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

  // 告知前端 Node 侧已就绪
  channel.send("gold:ready");
  console.log("[gold] embedded node IPC ready");
}

main();
