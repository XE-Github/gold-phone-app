"use client";

// 应用内 OTA 升级卡片（阶段4）。显示当前版本 + 「检查更新」。
//   - 原生壳：发现新版 → 一键下载 apk → 唤起系统安装器（用户在系统弹窗点「安装」）。
//   - 浏览器/dev：只提供跳转 GitHub Release 页让用户手动下载（canInstall=false）。

import { useState } from "react";
import {
  checkForUpdate,
  downloadAndInstall,
  currentVersion,
  type UpdateInfo,
  type OtaProgress,
} from "@/lib/ota";

type Phase = "idle" | "checking" | "result" | "downloading" | "installing" | "error";

export function UpdateCard() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [msg, setMsg] = useState("");
  const [pct, setPct] = useState<number | null>(null);

  async function onCheck() {
    setPhase("checking");
    setMsg("");
    const result = await checkForUpdate();
    setInfo(result);
    if (result.error) {
      setPhase("error");
      setMsg(result.error);
      return;
    }
    setPhase("result");
  }

  async function onInstall() {
    if (!info?.downloadUrl) return;
    setPhase("downloading");
    setPct(null);
    const ok = await downloadAndInstall(info.downloadUrl, (p: OtaProgress) => {
      if (p.phase === "downloading") {
        setPhase("downloading");
        setPct(p.total ? Math.round((p.received / p.total) * 100) : null);
      } else if (p.phase === "installing") {
        setPhase("installing");
      } else if (p.phase === "error") {
        setPhase("error");
        setMsg(p.message);
      }
    });
    if (!ok && phase !== "error") {
      setPhase("error");
      setMsg("未能完成安装");
    }
  }

  const cur = currentVersion();

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">检查更新</h2>
          <p className="text-[11px] tabular-nums text-slate-500">当前版本 v{cur}</p>
        </div>
        <button
          onClick={onCheck}
          disabled={phase === "checking" || phase === "downloading" || phase === "installing"}
          className="min-h-9 shrink-0 rounded-lg bg-sky-500/15 px-3 text-[11px] font-medium text-sky-300 disabled:opacity-50"
        >
          {phase === "checking" ? "检查中…" : "检查更新"}
        </button>
      </div>

      {/* 结果区 */}
      {phase === "result" && info && (
        <div className="mt-3 text-xs">
          {info.hasUpdate ? (
            <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] p-3">
              <p className="text-emerald-200">
                发现新版本 <b>{info.latestVersion}</b>（当前 v{info.currentVersion}）
              </p>
              {info.releaseNotes && (
                <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-emerald-100/70">
                  {info.releaseNotes}
                </pre>
              )}
              {info.canInstall && info.downloadUrl ? (
                <button
                  onClick={onInstall}
                  className="mt-2 min-h-11 w-full rounded-xl bg-amber-500 text-sm font-semibold text-slate-950 active:bg-amber-400"
                >
                  下载并安装
                </button>
              ) : (
                <a
                  href={info.releasePageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 flex min-h-11 items-center justify-center rounded-xl bg-sky-500/20 text-center text-sm text-sky-200"
                >
                  {info.downloadUrl ? "去下载页（当前环境不支持应用内安装）" : "打开 Release 页"}
                </a>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-white/5 bg-slate-900/40 p-3 text-slate-400">
              已是最新版本{info.latestVersion ? `（最新 ${info.latestVersion}）` : ""}。
            </p>
          )}
        </div>
      )}

      {/* 下载/安装进度 */}
      {(phase === "downloading" || phase === "installing") && (
        <div className="mt-3 text-xs text-slate-300">
          {phase === "downloading" ? (
            <p>正在下载新版本…{pct !== null ? ` ${pct}%` : ""}</p>
          ) : (
            <p>即将唤起系统安装器，请在系统弹窗点「安装」…</p>
          )}
        </div>
      )}

      {/* 错误 */}
      {phase === "error" && (
        <div className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/[0.08] p-3 text-xs text-rose-200">
          <p>{msg || "检查更新出错"}</p>
          {info?.releasePageUrl && (
            <a
              href={info.releasePageUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-rose-300 underline"
            >
              手动打开 Release 页
            </a>
          )}
        </div>
      )}
    </section>
  );
}
