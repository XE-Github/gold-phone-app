"use client";

// 强制同意门（首次启动）：点「同意」才进主页并开启匿名统计；点「不同意」直接退出 App。
// 见 docs/analytics-plan.md。consent 状态存本地，决定后不再问。
//
// ⚠️ 退出 App 用 @capacitor/app 的 exitApp()（运行期探测，无插件/web 时降级提示，不崩）。
// ⚠️ SSR/hydration：首屏先不渲染任何分支（决定前返回占位），挂载后再读 localStorage 决定，
//    避免「服务端不知道 consent → 客户端读到 → 闪烁/hydration 不一致」。

import { useEffect, useState } from "react";
import { getConsent, setConsent, trackAppOpen } from "@/lib/analytics";

type Decision = "loading" | "asking" | "granted";

// @capacitor/app 运行期探测（不静态 import，避免 web/dev 无插件时报错）。
interface AppPlugin {
  exitApp: () => Promise<void>;
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

export function ConsentGate({ children }: { children: React.ReactNode }) {
  const [decision, setDecision] = useState<Decision>("loading");

  // 挂载后读已存状态：已同意直接放行（并补一次启动埋点）；已拒绝过仍再问（拒绝=本次退出，
  // 不持久化"永久拒绝"——用户原话是"不同意就退出"，下次启动重新询问更符合"必须同意才能用"）。
  // queueMicrotask：把首屏决定推迟出 effect 同步体，满足 react-hooks/set-state-in-effect
  // （与 page.tsx / DiagPanel 同套路）。挂载前停在 loading 占位，避免 SSR/hydration 闪烁。
  useEffect(() => {
    queueMicrotask(() => {
      const c = getConsent();
      if (c === "granted") {
        setDecision("granted");
        void trackAppOpen();
      } else {
        setDecision("asking");
      }
    });
  }, []);

  function onAgree() {
    setConsent("granted");
    setDecision("granted");
    void trackAppOpen(); // 同意后立即记一次启动
  }

  function onDecline() {
    // 不同意 = 退出 App。原生壳调 exitApp；web/无插件时给出明确提示并尽量关闭。
    const app = getAppPlugin();
    if (app) {
      void app.exitApp().catch(() => {
        /* 退出失败也不崩；停在同意页即可（用户未获准进入） */
      });
      return;
    }
    // 非原生（PC dev / 浏览器）：无法真正杀进程，尝试关闭窗口 + 停在拦截页说明。
    try {
      window.close();
    } catch {
      /* 多数浏览器禁止脚本关闭非脚本打开的窗口 */
    }
    setDecision("loading"); // 回到占位（空白），不放行主页
  }

  if (decision === "loading") {
    // 首屏占位：避免 SSR/hydration 闪烁，也作为「不同意后」的空白拦截态。
    return <div className="min-h-dvh bg-slate-950" />;
  }

  if (decision === "asking") {
    return (
      <main
        className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6"
        style={{
          paddingTop: "max(2.5rem, var(--safe-top))",
          paddingBottom: "max(2.5rem, var(--safe-bottom))",
        }}
      >
        <div className="flex flex-1 flex-col justify-center">
          <h1 className="text-center text-3xl font-bold text-white">黄金看板</h1>

          <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-base font-semibold text-white">隐私说明</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">仅用于改进产品体验。</p>
            <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-slate-400">
              <li>· 采集：一个随机生成的匿名标识、设备型号、App 版本、时间</li>
              <li>· 不采集：手机序列号 / IMEI、真实身份、账号、位置、通讯录</li>
              <li>· 不记录你的原始 IP（仅保留所在国家/地区）</li>
            </ul>
            <p className="mt-3 text-[13px] leading-relaxed text-slate-400">
              需要你同意后才能进入应用。
            </p>
          </div>

          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2.5 text-[13px] leading-relaxed text-amber-200/90">
            请注意：本应用为学习辅助工具，非投资建议。
          </p>
        </div>

        <div className="mt-6 space-y-3">
          <button
            onClick={onAgree}
            className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-amber-500 text-base font-semibold text-slate-950 active:bg-amber-400"
          >
            同意并进入
          </button>
          <button
            onClick={onDecline}
            className="flex min-h-11 w-full items-center justify-center rounded-2xl border border-white/10 text-sm text-slate-400 active:bg-white/5"
          >
            不同意（退出应用）
          </button>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
