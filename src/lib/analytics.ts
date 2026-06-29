// 轻量埋点核心（PhoneApp 独立实现）。看「活跃 + 升级」两大类，粗粒度即可。
// 设计见 docs/analytics-plan.md。隔离纪律：埋点是旁路，fire-and-forget + try/catch 吞错，
// 绝不阻塞/拖累主功能（金价/积存金/OTA）。
//
// 数据流（阶段 2 起）：App → Cloudflare Worker（藏 token）→ GitHub 私有仓库。
// App 端零 token：只知道一个 Worker URL，不知道任何 GitHub 凭据。
//
// ⚠️ 隐私（强制同意门）：所有上报只在 consent=granted 时才生成/发送；未同意连 did 都不建。
//    采集字段仅：随机 UUID（did，非真实身份）+ 设备型号 + 版本 + 时间戳 + 事件名。
//    不采集真实 SN/IMEI、原始 IP（Worker 端只留国家码）、账号、位置。
//
// ⚠️ 阶段 1：ANALYTICS_ENDPOINT 留空 → 只把事件记到本地环形缓冲（供 /diag 预览），不真上传。
//    阶段 2 部署 Worker 后填上 URL，send() 自动改走内嵌 Node https POST（兑底 WebView fetch）。

import { isNativeApp } from "./apiBase";

// 阶段 2：填 CF Worker URL（中转 → 写 GitHub 私有仓库）。URL 本身公开、不含任何密钥。
// ⚠️ 诚实边界：这是 *.workers.dev 默认域名，国内常被 DNS 污染。设备只有在能连通 workers.dev
//    时（开 VPN/代理，或所在网络未污染该域名）才上报得出去；连不上则静默超时丢弃
//    （fire-and-forget，绝不影响主功能）。故统计为「能连通设备」的粗粒度活跃/升级，绝对值偏低，
//    用于看大致趋势够用。将来若绑自有域名（CF Custom Domain）改这里即可，无需动其它代码。
const ANALYTICS_ENDPOINT = "https://gold-phone-analytics.zhenengold.workers.dev";

const CONSENT_KEY = "gold_analytics_consent"; // "granted" | "declined"
const DID_KEY = "gold_analytics_did";
const LAST_VER_KEY = "gold_analytics_last_ver"; // 上次启动时的版本（用于检测刚升级）
const LOG_KEY = "gold_analytics_log"; // 本地事件环形缓冲（仅预览/自查用）
const LOG_MAX = 50; // 环形缓冲最多保留条数

export type AnalyticsEvent = "app_open" | "app_version" | "ota_action";
export type OtaAction = "check" | "download" | "install_launch";

type EventBody = {
  event: AnalyticsEvent;
  did: string;
  model: string;
  ver: string;
  ts: number;
  ext?: Record<string, unknown>;
};

// ── 同意状态 ──────────────────────────────────────────────────────────────────

export type ConsentState = "granted" | "declined" | "unset";

function lsGet(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, val: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, val);
  } catch {
    /* 隐私模式/存储满：吞掉，埋点不报错 */
  }
}

export function getConsent(): ConsentState {
  const v = lsGet(CONSENT_KEY);
  return v === "granted" || v === "declined" ? v : "unset";
}

export function setConsent(state: "granted" | "declined"): void {
  lsSet(CONSENT_KEY, state);
}

// ── 设备标识 + 型号 ─────────────────────────────────────────────────────────────

/** 安装级随机 UUID（首次生成存本地，去重用）。⚠️ 仅在已同意后才调用——未同意不建 did。 */
export function getOrCreateDeviceId(): string {
  let id = lsGet(DID_KEY);
  if (id) return id;
  id = "u_" + genUuid();
  lsSet(DID_KEY, id);
  return id;
}

/** 仅读已存在的 did，不创建（供预览：未同意时显示「未生成」）。 */
export function peekDeviceId(): string | null {
  return lsGet(DID_KEY);
}

function genUuid(): string {
  try {
    const c = (typeof globalThis !== "undefined" ? globalThis.crypto : undefined) as
      | Crypto
      | undefined;
    if (c?.randomUUID) return c.randomUUID();
    if (c?.getRandomValues) {
      const b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
  } catch {
    /* 落到下面的弱回退 */
  }
  // 极端回退（无 crypto）：不保证强随机，仅避免崩溃；正常设备走不到这里。
  return "x" + Math.abs(hashStr(String(performance?.now?.() ?? 0) + navUaSafe())).toString(16);
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function navUaSafe(): string {
  try {
    return typeof navigator !== "undefined" ? navigator.userAgent : "";
  } catch {
    return "";
  }
}

// @capacitor/device 运行期探测（不静态 import，避免 web/dev 无插件时报错；同 apiBase 风格）。
interface DevicePlugin {
  getInfo: () => Promise<{ manufacturer?: string; model?: string; platform?: string }>;
}

function getDevicePlugin(): DevicePlugin | null {
  try {
    if (typeof window === "undefined") return null;
    const cap = (window as unknown as { Capacitor?: { Plugins?: { Device?: DevicePlugin } } })
      .Capacitor;
    return cap?.Plugins?.Device ?? null;
  } catch {
    return null;
  }
}

let cachedModel: string | null = null;

/** 取设备型号（如 "Xiaomi 17 Pro"）。无插件/非原生时回退 "web" 或 UA 粗判。结果缓存。 */
export async function getModel(): Promise<string> {
  if (cachedModel) return cachedModel;
  try {
    const dev = getDevicePlugin();
    if (dev) {
      const info = await dev.getInfo();
      const maker = (info.manufacturer ?? "").trim();
      const model = (info.model ?? "").trim();
      const joined = [maker, model].filter(Boolean).join(" ").trim();
      cachedModel = joined || (info.platform ?? "unknown");
      return cachedModel;
    }
  } catch {
    /* 落回退 */
  }
  cachedModel = isNativeApp() ? "native-unknown" : "web";
  return cachedModel;
}

// ── 本地事件环形缓冲（仅供 /diag 预览/自查；不含敏感数据） ──────────────────────────

function readLog(): EventBody[] {
  try {
    const raw = lsGet(LOG_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as EventBody[]) : [];
  } catch {
    return [];
  }
}

function appendLog(ev: EventBody): void {
  try {
    const log = readLog();
    log.push(ev);
    while (log.length > LOG_MAX) log.shift();
    lsSet(LOG_KEY, JSON.stringify(log));
  } catch {
    /* 吞掉 */
  }
}

/** 供 /diag 预览：返回本地记录的事件（最新在后）。 */
export function getLocalEventLog(): EventBody[] {
  return readLog();
}

// ── 发送（阶段 1 只本地记录；阶段 2 走内嵌 Node / WebView fetch） ──────────────────

function appVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
}

// 内嵌 Node 发送通道（阶段 2 接通）：经 IPC 让 Node 用 https POST 到 Worker，
// 绕开 WebView 的 CORS / UA 丢弃坑（同 OTA 踩过的 crbug 571722）。
interface NodeTrackPlugin {
  send: (opts: { eventName: string; args?: unknown[] }) => Promise<unknown>;
}
function getNodePlugin(): NodeTrackPlugin | null {
  try {
    if (typeof window === "undefined") return null;
    const cap = (window as unknown as { Capacitor?: { Plugins?: { CapacitorNodeJS?: NodeTrackPlugin } } })
      .Capacitor;
    return cap?.Plugins?.CapacitorNodeJS ?? null;
  } catch {
    return null;
  }
}

/**
 * 构造并「发送」一条埋点。fire-and-forget：永不抛、永不阻塞调用方。
 * - 未同意 → 直接返回（不生成 did、不记录、不发送）。
 * - 已同意 → 构造事件、记本地环形缓冲（预览用）；若配了 endpoint 则尝试上传（失败静默丢弃，无重试队列）。
 */
async function send(event: AnalyticsEvent, ext?: Record<string, unknown>): Promise<void> {
  try {
    if (getConsent() !== "granted") return; // 同意门：未同意一律不采集

    const body: EventBody = {
      event,
      did: getOrCreateDeviceId(),
      model: await getModel(),
      ver: appVersion(),
      ts: Date.now(),
      ...(ext ? { ext } : {}),
    };

    appendLog(body); // 本地预览（阶段 1 唯一去处）

    if (!ANALYTICS_ENDPOINT) return; // 阶段 1：URL 空 = 只本地记录

    // 阶段 2：优先经内嵌 Node 上传（Node https，无 WebView CORS/UA 问题）；兑底 WebView fetch。
    const node = getNodePlugin();
    if (node) {
      void node
        .send({ eventName: "gold:track", args: [{ endpoint: ANALYTICS_ENDPOINT, body }] })
        .catch(() => {});
      return;
    }
    if (typeof fetch === "function") {
      void fetch(ANALYTICS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* 埋点绝不影响主功能 */
  }
}

// ── 对外埋点 API（极简） ─────────────────────────────────────────────────────────

/**
 * App 启动埋点：发 app_open；若检测到版本与上次记录不同（刚升级），顺带发 app_version{from,to}。
 * 在主页（同意后）启动时调一次。
 */
export async function trackAppOpen(): Promise<void> {
  try {
    if (getConsent() !== "granted") return;
    const cur = appVersion();
    const last = lsGet(LAST_VER_KEY);
    await send("app_open");
    if (last && last !== cur) {
      await send("app_version", { from: last, to: cur });
    }
    lsSet(LAST_VER_KEY, cur); // 记录本次版本，供下次比对
  } catch {
    /* 吞掉 */
  }
}

/** OTA 动作埋点：用户点检查更新 / 触发下载 / 唤起安装时各调一次。 */
export async function trackOta(action: OtaAction): Promise<void> {
  try {
    await send("ota_action", { ota: action });
  } catch {
    /* 吞掉 */
  }
}
