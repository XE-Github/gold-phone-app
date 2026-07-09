"use client";

import { useEffect, useState } from "react";
import {
  backgroundDataStatus,
  backgroundDataSupported,
  startBackgroundData,
  stopBackgroundData,
} from "@/lib/backgroundData";

type Phase = "idle" | "busy" | "error";

export function BackgroundDataCard() {
  const [supported, setSupported] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    queueMicrotask(() => {
      const ok = backgroundDataSupported();
      setSupported(ok);
      if (!ok) return;
      void backgroundDataStatus()
        .then(setRunning)
        .catch(() => setMsg("无法读取后台服务状态"));
    });
  }, []);

  async function toggle() {
    if (!supported || phase === "busy") return;
    setPhase("busy");
    setMsg("");
    try {
      const next = running ? await stopBackgroundData() : await startBackgroundData();
      setRunning(next);
      setPhase("idle");
    } catch (error) {
      setPhase("error");
      setMsg(error instanceof Error ? error.message : "后台服务操作失败");
    }
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">后台数据服务</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">
            开启后会显示常驻通知，由 Android 原生服务在后台抓取行情并判断提醒。
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={!supported || phase === "busy"}
          className={`min-h-9 shrink-0 rounded-lg px-3 text-[13px] font-medium disabled:opacity-50 ${
            running ? "bg-emerald-500/15 text-emerald-300" : "bg-sky-500/15 text-sky-300"
          }`}
        >
          {phase === "busy" ? "处理中…" : running ? "已开启" : "开启"}
        </button>
      </div>

      <div className="mt-3 rounded-xl border border-amber-400/15 bg-amber-500/[0.06] p-3 text-[13px] leading-relaxed text-amber-100/75">
        <p>说明：这是 Android 前台服务，会增加耗电；当前后台原生抓取覆盖行情/交易所标的，银行积存金仍以前台数据为准。</p>
        <p className="mt-1">部分国产 ROM 仍可能因省电策略限制，需要真机长时间验证。</p>
        {!supported && <p className="mt-1 text-slate-400">当前环境不是原生 App，无法开启。</p>}
        {phase === "error" && <p className="mt-1 text-rose-200">{msg || "后台服务操作失败"}</p>}
      </div>
    </section>
  );
}
