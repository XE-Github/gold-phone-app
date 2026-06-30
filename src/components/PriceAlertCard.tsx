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
            className={`min-h-9 shrink-0 rounded-lg px-3 text-[13px] font-medium disabled:opacity-60 ${notifyBtn.cls}`}
          >
            {notifyBtn.text}
          </button>
        )}
      </div>

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
        {error && <p className="text-[13px] text-rose-400">{error}</p>}
      </div>

      {/* 规则列表：左右两栏——左[信息行 + 今日计数]可截、右[操作按钮组]垂直居中。
          按钮 ≥44px 守触摸目标；右栏 items-center 让按钮相对整张卡片高度上下居中。 */}
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
                className="flex items-center gap-2 rounded-xl border border-white/5 bg-slate-900/40 p-3"
              >
                {/* 左栏：信息行 + 今日计数（可截，占满剩余宽度） */}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {/* 信息行：标的名(可截断) + 阈值+单位(完整不截断) */}
                  <div className="flex items-baseline gap-1.5 text-sm text-white">
                    <span className="min-w-0 truncate">{meta?.shortName ?? rule.instrumentId}</span>
                    {/* 阈值是核心数据：whitespace-nowrap + shrink-0 永不截；单位紧跟阈值后 */}
                    <span
                      className={`shrink-0 whitespace-nowrap tabular-nums ${
                        rule.direction === "above" ? "text-rose-400" : "text-emerald-400"
                      }`}
                    >
                      {rule.direction === "above" ? "≥" : "≤"} {fmtPrice(rule.threshold)}
                      {meta?.unit ? <span className="ml-1 text-slate-500">{meta.unit}</span> : null}
                    </span>
                  </div>
                  {/* 今日计数：信息行下方普通文字（不用胶囊徽章），左对齐 */}
                  {todayCount > 0 && (
                    <p className="text-[13px] tabular-nums text-slate-400">
                      今日 {todayCount} 次
                    </p>
                  )}
                </div>
                {/* 右栏：操作按钮组，items-center 让按钮相对整张卡片高度上下居中（图标省地方，红绿语义色保留） */}
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => onToggle(rule.id)}
                    aria-label={rule.enabled ? "停用此提醒" : "启用此提醒"}
                    title={rule.enabled ? "启用中（点击停用）" : "已停用（点击启用）"}
                    className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg ${
                      rule.enabled
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-slate-700/40 text-slate-400"
                    }`}
                  >
                    {/* 开关 toggle：启用=圆点在右(开)、停用=圆点在左(关) */}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5">
                      <rect x="1" y="6" width="22" height="12" rx="6" />
                      <circle cx={rule.enabled ? 17 : 7} cy="12" r="3" fill="currentColor" stroke="none" />
                    </svg>
                  </button>
                  <button
                    onClick={() => onRemove(rule.id)}
                    aria-label="删除规则"
                    title="删除此提醒"
                    className="flex min-h-11 min-w-11 items-center justify-center rounded-lg bg-rose-500/10 text-rose-300"
                  >
                    {/* 垃圾桶 */}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <path d="M3 6h18" />
                      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
                      <path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
                      <path d="M10 11v6M14 11v6" />
                    </svg>
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
