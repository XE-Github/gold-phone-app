"use client";

// 前端统一取数传输层（PhoneApp）。
//
// 背景：原本前端写死同源相对路径 `/api/*`（dev/`next start` 时前端与 API 路由同源）。
// 改造成安卓 App（静态导出 + Capacitor 套壳）后，同源 `/api` 不再成立——数据由「内嵌
// Node（@choreruiz/capacitor-node-js）」在 App 内提供。该插件官方通信是 IPC 消息通道
// （bridge channel），不是 HTTP。故本层对外只暴露两个与传输无关的原语：
//
//   requestRoute<T>(route)              —— 请求/响应（quotes、bank-gold、history 用）
//   subscribeStream(onData, onStatus)   —— 持续推送（stream 用）
//
// 三态分派（优先级从高到低）：
//   1. 原生 App + 内嵌 Node 插件在场  → IPC（NodeJS.send / addListener，官方背书，最稳）
//   2. 配置了 HTTP base（局域网/Termux/内嵌 http 兑底）→ fetch(base + route)（含 SSE）
//   3. 浏览器/dev（同源 Next /api 还在）→ fetch(route)（保持现有 dev 体验不变）
//
// 诚实：IPC 与 HTTP 都需联网抓上游；「数据闭环」指不依赖自建云服务器，不是离线可用。
// 兑底链路保证：即使 IPC 因插件未就绪/异常不可用，也会自动落到 HTTP / 同源 fetch。

import type { QuotesPayload, BankGoldPayload } from "./types";
import type { HistoryPayload } from "./history";

// 内嵌 Node 的 HTTP 兑底服务约定端口（embeddedServer.ts 监听同一端口）。
export const EMBEDDED_NODE_PORT = 3100;

// IPC 事件名（前后端约定一致，见 public/nodejs-project 入口）。
const IPC_REQ = "gold:req"; // 前端→Node：发起一次路由请求 {id, route}
const IPC_RES = "gold:res"; // Node→前端：返回某次请求结果 {id, ok, data, error}
const IPC_STREAM = "gold:stream"; // Node→前端：行情流一帧 payload
const IPC_STREAM_START = "gold:stream:start"; // 前端→Node：开始推流
const IPC_STREAM_STOP = "gold:stream:stop"; // 前端→Node：停止推流

declare global {
  interface Window {
    __GOLD_API_BASE__?: string;
  }
}

// ── 路由类型映射（编译期约束 requestRoute 的返回类型） ──────────────────────────
export interface RouteResultMap {
  "/api/quotes": QuotesPayload;
  "/api/bank-gold": BankGoldPayload;
  "/api/history": HistoryPayload;
}
export type ApiRoute = keyof RouteResultMap;

// ── Capacitor / 插件运行期探测（不静态 import 插件，避免 web/dev 无插件时编译/运行报错） ──

interface NodeJSPlugin {
  send: (opts: { eventName: string; args?: unknown[] }) => Promise<unknown>;
  addListener: (
    eventName: string,
    cb: (event: { args: unknown[] }) => void,
  ) => Promise<{ remove: () => void } > | { remove: () => void };
}

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  Plugins?: { CapacitorNodeJS?: NodeJSPlugin };
};

function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** 是否运行在 Capacitor 原生壳内（apk）。无 Capacitor 时安全返回 false。 */
export function isNativeApp(): boolean {
  try {
    return getCapacitor()?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** 取内嵌 Node 插件（仅原生壳且插件注册成功时存在）；否则 null（自动落 HTTP/同源）。 */
function getNodePlugin(): NodeJSPlugin | null {
  try {
    return getCapacitor()?.Plugins?.CapacitorNodeJS ?? null;
  } catch {
    return null;
  }
}

/** 当前是否应走 IPC（原生壳 + 插件在场）。 */
function ipcAvailable(): boolean {
  return isNativeApp() && getNodePlugin() !== null;
}

// ── HTTP base 解析（兑底/dev 用） ─────────────────────────────────────────────

/** 解析 HTTP base（不带末尾斜杠）。IPC 不可用时的兑底地址。 */
export function getApiBase(): string {
  // 1) 运行期注入优先（原生壳启动内嵌 http 兑底后可注入实际端口）
  if (typeof window !== "undefined" && typeof window.__GOLD_API_BASE__ === "string") {
    return stripTrailingSlash(window.__GOLD_API_BASE__);
  }
  // 2) 构建期环境变量（过渡期可指向局域网/Termux，如 http://192.168.1.5:3100）
  const envBase = process.env.NEXT_PUBLIC_API_BASE;
  if (envBase && envBase.length > 0) {
    return stripTrailingSlash(envBase);
  }
  // 3) 原生壳但 IPC 不可用 → 落到内嵌 http 兑底 localhost
  if (isNativeApp()) {
    return `http://localhost:${EMBEDDED_NODE_PORT}`;
  }
  // 4) 浏览器/dev：同源相对
  return "";
}

/** 拼出某个 API 路径的完整地址。path 必须以 "/" 开头。用于 HTTP 兑底/dev。 */
export function apiUrl(path: string): string {
  return `${getApiBase()}${path}`;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

// ── IPC 请求/响应：按 id 匹配一次性回应 ─────────────────────────────────────────

let ipcReqSeq = 0;
const pendingReqs = new Map<number, (r: { ok: boolean; data?: unknown; error?: string }) => void>();
let resListenerBound = false;

/** 懒绑定 IPC 响应监听（只绑一次），按 id 分发到对应 pending resolver。 */
function ensureResListener(plugin: NodeJSPlugin): void {
  if (resListenerBound) return;
  resListenerBound = true;
  void plugin.addListener(IPC_RES, (event) => {
    const msg = event?.args?.[0] as
      | { id?: number; ok?: boolean; data?: unknown; error?: string }
      | undefined;
    if (!msg || typeof msg.id !== "number") return;
    const resolver = pendingReqs.get(msg.id);
    if (!resolver) return;
    pendingReqs.delete(msg.id);
    resolver({ ok: msg.ok === true, data: msg.data, error: msg.error });
  });
}

const IPC_TIMEOUT_MS = 20000;

function requestViaIpc<R>(plugin: NodeJSPlugin, route: ApiRoute): Promise<R> {
  ensureResListener(plugin);
  const id = ++ipcReqSeq;
  return new Promise<R>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingReqs.delete(id);
      reject(new Error(`IPC 请求超时：${route}`));
    }, IPC_TIMEOUT_MS);

    pendingReqs.set(id, (r) => {
      clearTimeout(timer);
      if (r.ok) resolve(r.data as R);
      else reject(new Error(r.error || `IPC 请求失败：${route}`));
    });

    void plugin
      .send({ eventName: IPC_REQ, args: [{ id, route }] })
      .catch((e) => {
        clearTimeout(timer);
        pendingReqs.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
  });
}

// ── 对外原语 1：请求/响应 ────────────────────────────────────────────────────

/**
 * 请求一个路由并拿到结果。原生壳走 IPC，否则走 HTTP/同源 fetch。
 * IPC 调用失败时自动回退到 HTTP，保证「不断流」。
 */
export async function requestRoute<K extends ApiRoute>(route: K): Promise<RouteResultMap[K]> {
  if (ipcAvailable()) {
    const plugin = getNodePlugin();
    if (plugin) {
      try {
        return await requestViaIpc<RouteResultMap[K]>(plugin, route);
      } catch {
        // IPC 异常 → 落 HTTP 兑底（下方）
      }
    }
  }
  const res = await fetch(apiUrl(route), { cache: "no-store" });
  return (await res.json()) as RouteResultMap[K];
}

// ── 对外原语 2：行情流订阅 ────────────────────────────────────────────────────

export type StreamStatus = "connecting" | "connected" | "polling";

/**
 * 订阅行情推送流。返回取消订阅函数。
 *   - 原生壳：IPC 通道（Node 持续 channel.send('gold:stream')），最稳。
 *   - 否则：HTTP SSE（EventSource(base + /api/stream)），失败由调用方降级轮询。
 * onData 收到一帧 QuotesPayload；onStatus 报告连接态（可选）。
 */
export function subscribeStream(
  onData: (payload: QuotesPayload) => void,
  onStatus?: (status: StreamStatus) => void,
): () => void {
  // 原生壳 + 插件 → IPC 流
  if (ipcAvailable()) {
    const plugin = getNodePlugin();
    if (plugin) {
      let disposed = false;
      let removeListener: (() => void) | null = null;

      onStatus?.("connecting");
      const bind = plugin.addListener(IPC_STREAM, (event) => {
        if (disposed) return;
        const payload = event?.args?.[0] as QuotesPayload | undefined;
        if (payload && Array.isArray(payload.quotes)) {
          onStatus?.("connected");
          onData(payload);
        }
      });
      // addListener 可能返回 Promise<{remove}> 或 {remove}，两种都兼容
      Promise.resolve(bind).then((h) => {
        if (disposed) h?.remove?.();
        else removeListener = () => h?.remove?.();
      });
      void plugin.send({ eventName: IPC_STREAM_START, args: [] }).catch(() => {});

      return () => {
        disposed = true;
        void plugin.send({ eventName: IPC_STREAM_STOP, args: [] }).catch(() => {});
        removeListener?.();
      };
    }
  }

  // 否则：HTTP SSE 兑底
  return subscribeViaSSE(onData, onStatus);
}

/** HTTP SSE 兑底（EventSource）。仅负责连一次；断线降级/重连由 quotesStream 管。 */
function subscribeViaSSE(
  onData: (payload: QuotesPayload) => void,
  onStatus?: (status: StreamStatus) => void,
): () => void {
  let disposed = false;
  let es: EventSource | null = null;
  onStatus?.("connecting");
  try {
    es = new EventSource(apiUrl("/api/stream"));
  } catch {
    return () => {
      disposed = true;
    };
  }
  es.onopen = () => {
    if (!disposed) onStatus?.("connected");
  };
  es.onmessage = (event) => {
    if (disposed) return;
    try {
      onData(JSON.parse(event.data) as QuotesPayload);
    } catch {
      /* 忽略心跳/解析失败 */
    }
  };
  es.onerror = () => {
    if (!disposed) onStatus?.("polling");
  };
  return () => {
    disposed = true;
    es?.close();
    es = null;
  };
}

// 导出 IPC 事件名常量，供内嵌 Node 入口复用同一套约定（单一事实来源）。
export const IPC_EVENTS = {
  REQ: IPC_REQ,
  RES: IPC_RES,
  STREAM: IPC_STREAM,
  STREAM_START: IPC_STREAM_START,
  STREAM_STOP: IPC_STREAM_STOP,
} as const;
