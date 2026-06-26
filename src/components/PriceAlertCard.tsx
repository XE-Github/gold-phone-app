"use client";

import { useState } from "react";
import type { AlertDirection, AlertRule } from "@/lib/usePriceAlerts";
import { QUOTE_METAS, QUICK_METAS, metaFor, fmtPrice } from "@/lib/display";

const ALERTABLE = [...QUOTE_METAS, ...QUICK_METAS].filter((m) => m.unit !== "");

export function PriceAlertCard({
  rules,
  hydrated,
  priceById,
  onAdd,
  onRemove,
  onToggle,
  onRequestPermission,
}: {
  rules: AlertRule[];
  hydrated: boolean;
  priceById: Map<string, number>;
  onAdd: (rule: Omit<AlertRule, "id">) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onRequestPermission: () => Promise<string>;
}) {
  const [instrumentId, setInstrumentId] = useState("xau-cny");
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [thresholdStr, setThresholdStr] = useState("");
  const [sound, setSound] = useState(true);
  const [error, setError] = useState("");

  const currentPrice = priceById.get(instrumentId);

  function submit() {
    const threshold = Number(thresholdStr);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      setError("请输入有效的价格阈值");
      return;
    }
    setError("");
    onAdd({ instrumentId, direction, threshold, enabled: true, sound });
    setThresholdStr("");
    void onRequestPermission();
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">价格提醒</h2>
        <span className="text-[11px] text-slate-500">本地保存 · 仅本机</span>
      </div>

      {/* 新建规则 */}
      <div className="mt-3 space-y-2.5">
        <div className="flex flex-wrap gap-2">
          <select
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
            className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm text-white"
            aria-label="选择监控标的"
          >
            {ALERTABLE.map((m) => (
              <option key={m.instrumentId} value={m.instrumentId}>
                {m.shortName}（{m.unit}）
              </option>
            ))}
          </select>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as AlertDirection)}
            className="min-h-[44px] w-[92px] rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm text-white"
            aria-label="选择方向"
          >
            <option value="above">突破 ≥</option>
            <option value="below">跌破 ≤</option>
          </select>
        </div>
        <div className="flex gap-2">
          <input
            inputMode="decimal"
            value={thresholdStr}
            onChange={(e) => setThresholdStr(e.target.value)}
            placeholder={
              currentPrice ? `当前约 ${fmtPrice(currentPrice)}` : "输入价格阈值"
            }
            className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm tabular-nums text-white placeholder:text-slate-500"
            aria-label="价格阈值"
          />
          <button
            onClick={submit}
            className="min-h-[44px] rounded-xl bg-amber-500 px-5 text-sm font-semibold text-slate-950 active:bg-amber-400"
          >
            添加
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
            className="h-4 w-4 accent-amber-500"
          />
          触发时播放提示音（需先与页面交互一次浏览器才允许出声）
        </label>
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      {/* 规则列表 */}
      <div className="mt-4 space-y-2">
        {!hydrated ? (
          <p className="text-xs text-slate-500">加载本地提醒规则…</p>
        ) : rules.length === 0 ? (
          <p className="text-xs text-slate-500">
            还没有提醒规则。设置后价格触达阈值会在页面顶部弹出提示。
          </p>
        ) : (
          rules.map((rule) => {
            const meta = metaFor(rule.instrumentId);
            return (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">
                    {meta?.shortName ?? rule.instrumentId}{" "}
                    <span className={rule.direction === "above" ? "text-rose-400" : "text-emerald-400"}>
                      {rule.direction === "above" ? "≥" : "≤"} {fmtPrice(rule.threshold)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {rule.sound ? "🔔 有声" : "🔕 静音"} · {meta?.unit}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => onToggle(rule.id)}
                    className={`min-h-[36px] rounded-lg px-2.5 text-xs ${
                      rule.enabled
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-slate-700/40 text-slate-400"
                    }`}
                  >
                    {rule.enabled ? "启用中" : "已停用"}
                  </button>
                  <button
                    onClick={() => onRemove(rule.id)}
                    className="min-h-[36px] rounded-lg bg-rose-500/10 px-2.5 text-xs text-rose-300"
                    aria-label="删除规则"
                  >
                    删除
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
