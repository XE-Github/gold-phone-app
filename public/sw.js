// 极简 Service Worker —— 仅为「在手机上弹出系统通知」服务。
// 移动端浏览器(尤其安卓 Chrome)不允许页面用 new Notification() 直接弹，
// 必须经由已注册的 Service Worker 的 registration.showNotification()。
// 这里不做离线缓存（看板需要实时数据，缓存反而有害），只处理通知与点击。

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// 页面通过 postMessage 把通知内容发给 SW，由 SW 弹出（移动端可靠路径）。
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "show-notification") {
    const title = data.title || "黄金价格提醒";
    const options = {
      body: data.body || "",
      tag: data.tag || "gold-price-alert",
      renotify: true,
      requireInteraction: false,
      icon: data.icon,
      badge: data.badge,
    };
    self.registration.showNotification(title, options);
  }
});

// 点击通知 → 聚焦已打开的页面（没有就打开一个）。
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    }),
  );
});
