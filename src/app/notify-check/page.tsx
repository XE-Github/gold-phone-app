"use client";

// 通知诊断页（PhoneApp，纯客户端）。
// 用途：手机一打开即看到「这个站点」在当前浏览器里的通知真实状态，
// 一眼定位「点开启通知却被拒绝」卡在哪一环——是浏览器记住了拒绝(denied)、
// 还是非安全上下文、还是 Service Worker 没注册上。
// 全部复用 src/lib/notify.ts 的既有逻辑，不重写。

import { useCallback, useEffect, useState } from "react";
import {
  notificationSupported,
  notificationPermission,
  requestNotificationPermission,
  registerNotificationSW,
  showSystemNotification,
} from "@/lib/notify";

type Diag = {
  secureContext: boolean;
  protocol: string;
  hostname: string;
  notifSupported: boolean;
  permission: string;
  swSupported: boolean;
  swRegistered: boolean;
  swScope: string;
};

function Row({ k, v, good }: { k: string; v: string; good?: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 text-sm">
      <span className="text-slate-400">{k}</span>
      <span
        className={`tabular-nums font-medium ${
          good === true ? "text-emerald-300" : good === false ? "text-rose-300" : "text-slate-200"
        }`}
      >
        {v}
      </span>
    </div>
  );
}

async function readDiag(): Promise<Diag> {
  const swSupported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator;
  let swRegistered = false;
  let swScope = "";
  if (swSupported) {
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      if (reg) {
        swRegistered = true;
        swScope = reg.scope;
      }
    } catch {
      /* ignore */
    }
  }
  return {
    secureContext: typeof window !== "undefined" ? window.isSecureContext : false,
    protocol: typeof location !== "undefined" ? location.protocol : "",
    hostname: typeof location !== "undefined" ? location.hostname : "",
    notifSupported: notificationSupported(),
    permission: notificationPermission(),
    swSupported,
    swRegistered,
    swScope,
  };
}

export default function NotifyCheck() {
  const [diag, setDiag] = useState<Diag | null>(null);
  const [log, setLog] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const d = await readDiag();
    setDiag(d);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void refresh());
  }, [refresh]);

  const append = useCallback((line: string) => {
    setLog((prev) => [
      `${new Date().toLocaleTimeString("zh-CN", { hour12: false })}  ${line}`,
      ...prev,
    ]);
  }, []);

  async function onRequest() {
    const r = await requestNotificationPermission();
    append(`请求通知权限 → 返回：${r}`);
    void refresh();
  }

  async function onTest() {
    const ok = await showSystemNotification("测试通知", "手机通知测试 ✅ 能看到这条就成功了");
    append(`发测试通知 → ${ok ? "已递交（true）" : "未递交（false，多半是未授权或不支持）"}`);
    void refresh();
  }

  async function onRegSW() {
    const reg = await registerNotificationSW();
    append(`注册 Service Worker → ${reg ? `成功，scope=${reg.scope}` : "失败（null）"}`);
    void refresh();
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-16 pt-4 text-white">
      <h1 className="text-lg font-bold">通知诊断 · /notify-check</h1>
      <p className="mt-1 text-[11px] text-slate-500">
        看这里判断「点开启通知却被拒绝」卡在哪一环。把下面的状态截图发回即可。
      </p>

      <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        {!diag ? (
          <p className="text-sm text-slate-400">读取中…</p>
        ) : (
          <>
            <Row
              k="安全上下文 isSecureContext"
              v={String(diag.secureContext)}
              good={diag.secureContext}
            />
            <Row k="协议 / 主机" v={`${diag.protocol}//${diag.hostname}`} />
            <Row k="支持 Notification" v={String(diag.notifSupported)} good={diag.notifSupported} />
            <Row
              k="通知权限 permission"
              v={diag.permission}
              good={
                diag.permission === "granted"
                  ? true
                  : diag.permission === "denied"
                    ? false
                    : null
              }
            />
            <Row k="支持 ServiceWorker" v={String(diag.swSupported)} good={diag.swSupported} />
            <Row
              k="SW 已注册 (/sw.js)"
              v={diag.swRegistered ? "是" : "否"}
              good={diag.swRegistered}
            />
            {diag.swScope && <Row k="SW scope" v={diag.swScope} />}
          </>
        )}
      </section>

      <section className="mt-3 grid grid-cols-1 gap-2">
        <button
          onClick={onRequest}
          className="min-h-[44px] rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950 active:bg-amber-400"
        >
          ① 请求通知权限
        </button>
        <button
          onClick={onRegSW}
          className="min-h-[44px] rounded-xl bg-sky-500/20 px-4 text-sm font-semibold text-sky-200 active:bg-sky-500/30"
        >
          ② 注册 Service Worker
        </button>
        <button
          onClick={onTest}
          className="min-h-[44px] rounded-xl bg-emerald-500/20 px-4 text-sm font-semibold text-emerald-200 active:bg-emerald-500/30"
        >
          ③ 发一条测试通知
        </button>
        <button
          onClick={() => void refresh()}
          className="min-h-11 rounded-xl border border-white/10 px-4 text-sm text-slate-300"
        >
          刷新状态
        </button>
      </section>

      {log.length > 0 && (
        <section className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
          <p className="mb-1 text-[11px] text-slate-500">操作日志（最新在上）</p>
          <div className="space-y-1 text-[11px] tabular-nums text-slate-300">
            {log.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        </section>
      )}

      {/* 安卓 Chrome 解锁步骤：permission=denied 时按这个走 */}
      <section className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.07] p-4 text-[12px] leading-relaxed text-amber-100/90">
        <p className="font-semibold text-amber-200">若上面权限显示 denied（被拒绝）怎么办？</p>
        <p className="mt-1 text-amber-100/80">
          浏览器记住了这个站点的「拒绝」后，点按钮<strong>不会再弹请求框</strong>，必须手动到站点设置改回：
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Chrome 打开本页 → 点地址栏左侧的 🔒 或 ⓘ 图标</li>
          <li>进「权限 / 网站设置」→ 找到「通知」</li>
          <li>从「屏蔽」改为「允许」（或「询问」）</li>
          <li>回本页点「刷新状态」，permission 应变成 granted</li>
        </ol>
        <p className="mt-2 text-amber-100/70">
          另一条路径：Chrome 设置 → 网站设置 → 通知 → 找到当前站点 → 改为允许。
        </p>
        <p className="mt-2 text-amber-100/60">
          注：手机系统层的「浏览器App 通知总开关」也要开着；两层都开通知才弹得出。
        </p>
      </section>
    </main>
  );
}
