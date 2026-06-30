"use client";

// 安卓系统返回键（物理键/手势返回）接入 + 首页双击退出。
//
// 背景：本 App 是 Capacitor 静态导出（output:"export"），靠 React state 切视图、非真路由；
// 二级页/弹窗都是页内覆盖层。默认情况下系统返回键不被拦截 → Capacitor 直接 exitApp，
// 覆盖层关不掉。这里接入 @capacitor/app 的 backButton 监听，让返回键按优先级逐级返回。
//
// ⚠️ 关键副作用：一旦注册 backButton 监听，Capacitor 不再执行默认 exitApp。
//    所以「首页按返回」必须由我们自己实现（双击退出），否则首页按返回毫无反应。
//
// ⚠️ 诚实边界：返回键 / 双击退出 / 手势返回全是真机才能验的安卓系统行为。
//    dev/web 无返回键、isNativeApp() 为 false → 本 hook 不注册监听（早退）。
//    「WEB 三连绿」只能证明编译不崩、守卫下不注册，不能证明真机返回逻辑正确，必须装机复核。
//
// 接入方式沿用全项目「零静态插件 import」约定：运行期探测 window.Capacitor.Plugins.App
// （范本 = ConsentGate.tsx），不静态 import @capacitor/app，配合 isNativeApp() 守卫，
// dev/web/SSR 零风险。

import { useEffect, useRef, useState } from "react";
import { isNativeApp } from "@/lib/apiBase";

// @capacitor/app 运行期探测（不静态 import；范本同 ConsentGate.tsx）。
// 类型补 backButton 监听与 exitApp；addListener 返回 Promise<{remove}> 或 {remove}（两种都兼容）。
type RemoveHandle = { remove?: () => void };
interface AppPlugin {
  exitApp?: () => Promise<void>;
  addListener?: (
    eventName: "backButton",
    cb: () => void,
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
 * 注册安卓系统返回键监听，按 onBack 内的逐级返回决策消费每次返回。
 *
 * 实现要点（避免 stale closure）：
 *  - 监听只注册一次（空依赖 effect），否则每次 render 重注册既浪费又可能丢事件；
 *  - 把最新决策放进 decideRef，每次 render 用无依赖 effect 同步 decideRef.current = onBack
 *    （ref 赋值非 setState，不触发 react-hooks/set-state-in-effect）；
 *  - handler 内只调 decideRef.current()，永远读到最新的 state 闭包。
 *  - 非原生壳（web/dev）直接早退、不注册——dev 没有返回键，注册也无意义。
 */
export function useAndroidBackButton(onBack: () => void): void {
  const decideRef = useRef(onBack);
  // 每次 render 刷新为最新回调（读最新 state）。ref 赋值不触发重渲染。
  useEffect(() => {
    decideRef.current = onBack;
  });

  useEffect(() => {
    if (!isNativeApp()) return; // web/dev/SSR：无返回键，不注册
    const plugin = getAppPlugin();
    if (!plugin?.addListener) return;

    // addListener 可能返回 Promise<{remove}> 或 {remove}，两种都兼容（同 apiBase.ts 写法）。
    let disposed = false;
    let removeListener: (() => void) | null = null;
    const bind = plugin.addListener("backButton", () => {
      decideRef.current();
    });
    Promise.resolve(bind).then((h) => {
      if (disposed) h?.remove?.();
      else removeListener = () => h?.remove?.();
    });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, []);
}

/**
 * 首页双击退出：第 1 次 requestExit → 显示「再按一次退出」提示并起 2s 计时；
 * 2s 内第 2 次 → exitApp()；超 2s 自动复位重新计数。
 *
 * armedRef 用 ref 而非 state：requestExit 与 setTimeout 回调都要读/写它，且不需要触发重渲染；
 * showHint 用 state：要驱动 toast 显隐。
 */
export function useDoubleBackExit(): { requestExit: () => void; showHint: boolean } {
  const armedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showHint, setShowHint] = useState(false);

  // 卸载清理计时器，避免泄漏 / 卸载后 setState。
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function requestExit() {
    if (armedRef.current) {
      // 2s 内第二次按 → 真退出。getAppPlugin 为空（web）时 exitApp?.() no-op，不崩。
      if (timerRef.current) clearTimeout(timerRef.current);
      armedRef.current = false;
      setShowHint(false);
      void getAppPlugin()?.exitApp?.().catch(() => {});
      return;
    }
    // 第一次按 → 弹提示、起 2s 复位计时
    armedRef.current = true;
    setShowHint(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      armedRef.current = false;
      setShowHint(false);
      timerRef.current = null;
    }, 2000);
  }

  return { requestExit, showHint };
}
