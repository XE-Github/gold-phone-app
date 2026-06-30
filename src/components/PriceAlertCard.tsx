"use client";

import { useEffect, useState } from "react";
import type { AlertDirection, AlertRule } from "@/lib/usePriceAlerts";
import { ALERT_METAS, metaFor, fmtPrice } from "@/lib/display";
import { notificationPermission, isNativeNotify } from "@/lib/notify";

const ALERTABLE = ALERT_METAS;

export function PriceAlertCard({
  rules,
  hydrated,
  priceById,
  counts,
  onAdd,
  onRemove,
  onToggle,
  onRequestPermission,
}: {
  rules: AlertRule[];
  hydrated: boolean;
  priceById: Map<string, number>;
  counts: Record<string, number>; // 各规则今日触发次数（按穿越累计，跨天归零）
  onAdd: (rule: Omit<AlertRule, "id">) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onRequestPermission: () => Promise<string>;
}) {
  const [instrumentId, setInstrumentId] = useState("xau-cny");
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [thresholdStr, setThresholdStr] = useState("");
  const [error, setError] = useState("");
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const [native, setNative] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      setNative(isNativeNotify());
      setPerm(notificationPermission());
    });
  }, []);

  const currentPrice = priceById.get(instrumentId);

  async function enableNotify() {
    const result = await onRequestPermission();
    setPerm(result as NotificationPermission | "unsupported");
  }

  // 原生壳与 Web 文案分流：原生不提「浏览器」，denied 也可在系统设置里改回。
  const notifyBtn = {
    granted: { text: "🔔 系统通知已开启", cls: "bg-emerald-500/15 text-emerald-300" },
    denied: native
      ? { text: "通知被关闭（去系统设置开启）", cls: "bg-rose-500/15 text-rose-300" }
      : { text: "通知被拒绝（去浏览器设置开启）", cls: "bg-rose-500/15 text-rose-300" },
    default: { text: "开启系统通知", cls: "bg-amber-500/20 text-amber-200" },
    unsupported: { text: native ? "通知不可用" : "浏览器不支持通知", cls: "bg-slate-700/40 text-slate-400" },
  }[perm];

  function submit() {
    const threshold = Number(thresholdStr);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      setError("请输入有效的价格阈值");
      return;
    }
    setError("");
    // sound 恒 true：App 默认通知时出声，不再由用户勾选
    onAdd({ instrumentId, direction, threshold, enabled: true, sound: true });
    setThresholdStr("");
    void onRequestPermission();
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">价格提醒</h2>
        {/* 已授权（App 默认开启）不显示按钮；仅 denied/default/unsupported 时给用户操作入口 */}
        {perm !== "granted" && (
          <button
            onClick={enableNotify}
            disabled={perm === "unsupported"}
            className={`min-h-9 shrink-0 rounded-lg px-3 text-[11px] font-medium disabled:opacity-60 ${notifyBtn.cls}`}
          >
            {notifyBtn.text}
          </button>
        )}
      </div>

      {/* 原生壳的「已解决 denied 死结」说明，仅装机时显示 */}
      {native && (
        <p className="mt-2 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] p-2.5 text-[11px] leading-relaxed text-emerald-100/85">
          ✅ App 版用<b>系统原生通知</b>，权限弹窗由系统弹出，不再像网页那样「拒绝一次就永久弹不出来」。
          若曾在系统里关掉，去「系统设置 → 应用 → 黄金看板 → 通知」开回即可。
        </p>
      )}

      {/* 新建规则：标的占 2/3、方向占 1/3（min-w-0 防长名撑破横向） */}
      <div className="mt-3 space-y-2.5">
        <div className="flex gap-2">
          <select
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
            className="min-h-11 min-w-0 flex-[2] rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm text-white"
            aria-label="选择监控标的"
          >
            {ALERTABLE.map((m) => (
              <option key={m.instrumentId} value={m.instrumentId}>
                {m.name}{m.unit ? `（${m.unit}）` : ""}
              </option>
            ))}
          </select>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as AlertDirection)}
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm text-white"
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
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900/60 px-3 text-sm tabular-nums text-white placeholder:text-slate-500"
            aria-label="价格阈值"
          />
          <button
            onClick={submit}
            className="min-h-11 shrink-0 rounded-xl bg-amber-500 px-5 text-sm font-semibold text-slate-950 active:bg-amber-400"
          >
            添加
          </button>
        </div>
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      {/* 规则列表：子卡纵向堆叠（信息行 / 元信息行 / 操作行），避免按钮挤掉阈值。
          操作按钮独占整行 → 升 min-h-11(44px) 守触摸目标。 */}
      <div className="mt-4 space-y-2">
        {!hydrated ? (
          <p className="text-sm text-slate-500">加载本地提醒规则…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-slate-500">
            还没有提醒规则。设置后价格触达阈值会在页面顶部弹出提示。
          </p>
        ) : (
          rules.map((rule) => {
            const meta = metaFor(rule.instrumentId);
            const todayCount = counts[rule.id] ?? 0;
            return (
              <div
                key={rule.id}
                className="flex flex-col gap-2 rounded-xl border border-white/5 bg-slate-900/40 p-3"
              >
                {/* 信息行：标的名(可截断) + 阈值(完整不截断) + 今日计数徽章 */}
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 text-sm text-white">
                    <span className="align-middle">{meta?.shortName ?? rule.instrumentId}</span>{" "}
                    <span
                      className={`whitespace-nowrap align-middle ${
                        rule.direction === "above" ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {rule.direction === "above" ? "≥" : "≤"} {fmtPrice(rule.threshold)}
                    </span>
                  </div>
                  {todayCount > 0 && (
                    <span className="shrink-0 rounded-full bg-slate-700/50 px-2 py-0.5 text-[11px] tabular-nums text-slate-300">
                      今日 {todayCount} 次
                    </span>
                  )}
                </div>
                {/* 元信息行 */}
                <div className="text-[11px] text-slate-500">🔔 有声 · {meta?.unit}</div>
                {/* 操作行：独占整行右对齐，按钮 ≥44px 触摸目标 */}
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => onToggle(rule.id)}
                    className={`min-h-11 rounded-lg px-4 text-[11px] font-medium ${
                      rule.enabled
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-slate-700/40 text-slate-400"
                    }`}
                  >
                    {rule.enabled ? "启用中" : "已停用"}
                  </button>
                  <button
                    onClick={() => onRemove(rule.id)}
                    className="min-h-11 rounded-lg bg-rose-500/10 px-4 text-[11px] font-medium text-rose-300"
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
