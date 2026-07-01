"use client";

// App 前台/后台状态信号 + 回前台回调（v0.1.20）。
//
// 用途：
//   1) 价格提醒「前台只弹应用内弹窗、后台才弹系统通知」——需要知道此刻 App 是否在前台。
//   2) 回前台「补检查/补提醒」——App 被系统挂起（进程冻结）期间不评估规则、不抓数据；
//      回到前台的瞬间要立刻用最新价复评一次，把冻结期间发生、且此刻仍成立的穿越补弹出来。
//
// ⚠️ 诚实边界：安卓进后台会挂起整个进程（含内嵌 Node 定时器 + WebView JS），
//    所以这不是「后台实时」——只能在【回前台】那一刻补检查。冻结期间瞬穿又回落的价格
//    检测不到（那段时间根本没采数）。真·后台实时需常驻通知栏前台服务或服务端推送（本项目回避）。
//    dev/web 无原生 appStateChange，退化用 document.visibilityState（切标签页可近似验证）。
//
// 接入方式沿用全项目「零静态插件 import」约定：运行期探测 window.Capacitor.Plugins.App
// （范本 = useAndroidBackButton.ts），配合 isNativeApp() 守卫，dev/web/SSR 零风险。

import { useEffect, useRef, useState } from "react";
import { isNativeApp } from "@/lib/apiBase";

// @capacitor/app 运行期探测（不静态 import）。appStateChange 报 {isActive:boolean}。
type RemoveHandle = { remove?: () => void };
interface AppPlugin {
  addListener?: (
    eventName: "appStateChange",
    cb: (state: { isActive: boolean }) => void,
  ) => Promise<RemoveHandle> | RemoveHandle;
}

function getAppPlugin(): AppPlugin | null {
  try {
    if (typeof window === "undefined") return null;
    const cap = (window as unknown as { Capacitor?: { Plugins?: { App?: AppPlugin } } }).Capacitor;
    return cap?.Plugins?.App ?? null;
  } catch {
    return null;
  }
}

/**
 * 前台状态 hook。
 * @param onResume 可选：从后台回到前台（false→true 跳变）时调用（读最新闭包，用 resumeRef 持有）。
 * @returns isForeground（state，驱动重渲染）+ foregroundRef（live ref，供 effect 内同步读最新值，
 *          避免把它放进依赖数组导致提醒 effect 反复重跑）。
 */
export function useAppForeground(onResume?: () => void): {
  isForeground: boolean;
  foregroundRef: React.MutableRefObject<boolean>;
} {
  const [isForeground, setForeground] = useState(true);
  const foregroundRef = useRef(true);
  // onResume 每次 render 刷新为最新闭包（ref 赋值不触发重渲染，同 useAndroidBackButton 的 decideRef）。
  const resumeRef = useRef(onResume);
  useEffect(() => {
    resumeRef.current = onResume;
  });

  useEffect(() => {
    // set：同步写 ref（effect 内可即时读）+ 驱动 state；false→true 跳变时触发 onResume。
    const set = (v: boolean) => {
      const prev = foregroundRef.current;
      foregroundRef.current = v;
      setForeground(v);
      if (!prev && v) resumeRef.current?.(); // 后台→前台：补检查
    };

    // 基线信号：document.visibilityState（web/native 都有）。初次 set 用 queueMicrotask
    // 推迟出 effect 同步体，满足 react-hooks/set-state-in-effect。
    const onVis = () => set(document.visibilityState === "visible");
    if (typeof document !== "undefined") {
      queueMicrotask(() => set(document.visibilityState === "visible"));
      document.addEventListener("visibilitychange", onVis);
    }

    // 原生：额外绑 @capacitor/app appStateChange（比 WebView visibilitychange 更可靠）。
    // 清理照抄 useAndroidBackButton：addListener 可能返回 Promise<{remove}> 或 {remove}。
    let disposed = false;
    let removeNative: (() => void) | null = null;
    if (isNativeApp()) {
      const plugin = getAppPlugin();
      const bind = plugin?.addListener?.("appStateChange", (s) => set(s.isActive));
      if (bind) {
        Promise.resolve(bind).then((h) => {
          if (disposed) h?.remove?.();
          else removeNative = () => h?.remove?.();
        });
      }
    }

    return () => {
      disposed = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVis);
      }
      removeNative?.();
    };
  }, []);

  return { isForeground, foregroundRef };
}
