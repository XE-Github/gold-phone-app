"use client";

// 系统桌面/手机通知。移动端关键点：必须经由 Service Worker 的 showNotification()，
// 纯 new Notification() 在安卓 Chrome 上弹不出来。这里：
//   1) 注册 /sw.js
//   2) 发通知优先 postMessage 给 SW（手机可靠），回退 registration.showNotification，
//      再回退 new Notification（桌面兜底）。

let swReady: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerNotificationSW(): Promise<ServiceWorkerRegistration | null> {
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

export function notificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!notificationSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  try {
    if (!notificationSupported()) return "unsupported";
    if (Notification.permission === "granted") {
      // 已授权，顺便确保 SW 就绪（手机弹窗依赖它）
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
