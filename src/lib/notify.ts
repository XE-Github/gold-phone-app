"use client";

// 系统桌面/手机通知。两套实现，运行期分派：
//
//   A) 原生 App（Capacitor 套壳，apk）→ @capacitor/local-notifications（系统原生通知）。
//      关键价值：权限弹窗是【系统原生】，绕开浏览器「站点通知一旦 denied 永不再弹」的死结。
//   B) Web（手机浏览器 / 桌面）→ 经 Service Worker 的 showNotification()（手机唯一可靠路径），
//      回退 registration.showNotification，再回退 new Notification（桌面兜底）。
//
// 不静态 import 插件（与 apiBase 同套路）：web/dev 无插件时静态 import 会运行期炸；改用
// 运行期探测 window.Capacitor.Plugins.LocalNotifications，拿不到就走 Web 分支。
//
// 权限模型差异：Web 的 Notification.permission 是【同步】可读；原生插件 checkPermissions()
// 是【异步】。为不破坏现有同步调用方（notificationPermission()），原生权限用模块级缓存
// nativePermCache：异步处（request/确保 SW 处）刷新它，同步处读缓存。

import { isNativeApp } from "./apiBase";

// ── 原生插件运行期探测（不静态 import） ──────────────────────────────────────────

type PermState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

interface LocalNotificationsPlugin {
  checkPermissions: () => Promise<{ display: PermState }>;
  requestPermissions: () => Promise<{ display: PermState }>;
  schedule: (opts: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      schedule?: { at: Date };
    }>;
  }) => Promise<unknown>;
}

function getLocalNotifications(): LocalNotificationsPlugin | null {
  try {
    if (typeof window === "undefined") return null;
    const cap = (window as unknown as {
      Capacitor?: { Plugins?: { LocalNotifications?: LocalNotificationsPlugin } };
    }).Capacitor;
    return cap?.Plugins?.LocalNotifications ?? null;
  } catch {
    return null;
  }
}

/** 当前是否走原生通知（原生壳 + 插件在场）。否则走 Web。 */
function nativeNotifyAvailable(): boolean {
  return isNativeApp() && getLocalNotifications() !== null;
}

// 原生通知 id 自增（schedule 要求每条唯一 id）。
let nativeNotifSeq = 1;
// 原生权限同步缓存（异步查询/请求后回填，供同步的 notificationPermission() 读取）。
let nativePermCache: NotificationPermission | null = null;

// 把插件的 PermState 归一到与 Web 一致的 NotificationPermission 三态。
function mapNativePerm(s: PermState): NotificationPermission {
  if (s === "granted") return "granted";
  if (s === "denied") return "denied";
  return "default"; // prompt / prompt-with-rationale → 还可再弹
}

// ── Web Service Worker（仅 Web 分支使用） ───────────────────────────────────────

let swReady: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerNotificationSW(): Promise<ServiceWorkerRegistration | null> {
  // 原生壳不需要也不应注册 SW（无 /sw.js、且通知走原生）；预热原生权限缓存即可。
  if (nativeNotifyAvailable()) {
    void refreshNativePermCache();
    return Promise.resolve(null);
  }
  if (swReady) return swReady;
  swReady = (async () => {
    try {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
      const reg = await navigator.serviceWorker.register("/sw.js");
      // 等到激活可用
      await navigator.serviceWorker.ready;
      return reg;
    } catch {
      return null;
    }
  })();
  return swReady;
}

// 异步刷新原生权限缓存（不弹框，仅查询）。
async function refreshNativePermCache(): Promise<NotificationPermission | "unsupported"> {
  const plugin = getLocalNotifications();
  if (!plugin) return "unsupported";
  try {
    const { display } = await plugin.checkPermissions();
    nativePermCache = mapNativePerm(display);
    return nativePermCache;
  } catch {
    return "denied";
  }
}

export function notificationSupported(): boolean {
  if (nativeNotifyAvailable()) return true; // 原生壳始终支持
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (nativeNotifyAvailable()) {
    // 同步读缓存；首次未缓存时返回 "default"（未知，可请求），并异步预热缓存。
    if (nativePermCache === null) void refreshNativePermCache();
    return nativePermCache ?? "default";
  }
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  // ── 原生分支：系统原生权限弹窗（绕开浏览器 denied 死结） ──
  if (nativeNotifyAvailable()) {
    const plugin = getLocalNotifications();
    if (!plugin) return "unsupported";
    try {
      // 已授权直接回；否则请求（系统弹窗，即便此前点过拒绝也走系统设置语义，不会像浏览器永久锁死）
      const current = await plugin.checkPermissions();
      if (current.display === "granted") {
        nativePermCache = "granted";
        return "granted";
      }
      const { display } = await plugin.requestPermissions();
      nativePermCache = mapNativePerm(display);
      return nativePermCache;
    } catch {
      return "denied";
    }
  }

  // ── Web 分支（原逻辑保持不变） ──
  try {
    if (!notificationSupported()) return "unsupported";
    if (Notification.permission === "granted") {
      void registerNotificationSW();
      return "granted";
    }
    const result = await Notification.requestPermission();
    if (result === "granted") void registerNotificationSW();
    return result;
  } catch {
    return "denied";
  }
}

// 发一条系统通知。返回是否成功递交（不保证用户可见，受系统设置影响）。
export async function showSystemNotification(title: string, body: string): Promise<boolean> {
  // ── 原生分支：LocalNotifications.schedule（立即触发：不带 schedule.at 即为即时） ──
  if (nativeNotifyAvailable()) {
    const plugin = getLocalNotifications();
    if (!plugin) return false;
    try {
      // 权限未授时不递交（避免静默失败被误读为成功）
      if (nativePermCache !== "granted") {
        const { display } = await plugin.checkPermissions();
        nativePermCache = mapNativePerm(display);
        if (nativePermCache !== "granted") return false;
      }
      await plugin.schedule({
        notifications: [
          {
            id: nativeNotifSeq++ % 2147483647 || 1, // 32 位正整数，避免溢出/0
            title,
            body,
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── Web 分支（原逻辑保持不变） ──
  try {
    if (!notificationSupported() || Notification.permission !== "granted") return false;

    // 1) 优先：已注册的 SW（手机唯一可靠路径）
    const reg = await registerNotificationSW();
    if (reg) {
      // 1a) 通过 controller postMessage（SW 已接管页面时）
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "show-notification",
          title,
          body,
          tag: "gold-price-alert",
        });
        return true;
      }
      // 1b) 直接用 registration.showNotification
      if ("showNotification" in reg) {
        await reg.showNotification(title, { body, tag: "gold-price-alert" });
        return true;
      }
    }

    // 2) 回退：桌面端 new Notification
    new Notification(title, { body });
    return true;
  } catch {
    return false;
  }
}

/** 是否运行在原生通知环境（供 UI 文案分支：原生壳不该提「浏览器设置」）。 */
export function isNativeNotify(): boolean {
  return nativeNotifyAvailable();
}
