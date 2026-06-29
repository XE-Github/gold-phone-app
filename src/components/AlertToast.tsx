"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FiredAlert } from "@/lib/usePriceAlerts";
import { metaFor, fmtPrice } from "@/lib/display";

export function AlertToast({
  fired,
  onDismiss,
}: {
  fired: FiredAlert | null;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  // 自动消失
  useEffect(() => {
    if (!fired) return;
    const t = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(t);
  }, [fired, onDismiss]);

  if (!mounted || !fired) return null;

  const meta = metaFor(fired.rule.instrumentId);
  const dir = fired.rule.direction === "above" ? "突破上限" : "跌破下限";
  const up = fired.rule.direction === "above";

  return createPortal(
    <div
      role="alert"
      className="fixed left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2"
      style={{
        // 顶部吃状态栏安全区（Capacitor edge-to-edge 下避免钻到状态栏底下）
        top: "calc(var(--safe-top) + 0.75rem)",
        animation: "toast-in 0.25s ease-out",
      }}
    >
      <div
        className={`rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur ${
          up
            ? "border-rose-400/40 bg-rose-500/15"
            : "border-emerald-400/40 bg-emerald-500/15"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-white">
              🔔 {meta?.shortName ?? fired.rule.instrumentId} {dir}
            </p>
            <p className="mt-0.5 text-xs text-slate-200">
              当前 <span className="tabular-nums">{fmtPrice(fired.price)}</span>{" "}
              {meta?.unit} · 阈值 {fmtPrice(fired.rule.threshold)}
            </p>
          </div>
          <button
            onClick={onDismiss}
            className="min-h-9 shrink-0 rounded-lg bg-white/10 px-3 text-xs font-medium text-white"
            aria-label="关闭提示"
          >
            知道了
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
