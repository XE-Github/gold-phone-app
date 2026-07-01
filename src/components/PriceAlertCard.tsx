"use client";

import { useState } from "react";
import type { AlertDirection, AlertRule } from "@/lib/usePriceAlerts";
import { ALERT_METAS, metaFor, fmtPrice } from "@/lib/display";

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

  const currentPrice = priceById.get(instrumentId);

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
      {/* 不再单设「开启系统通知」按钮：添加第一条提醒时 submit() 会自动请求系统权限
          （见下方 void onRequestPermission()），系统弹窗即时出现，无需额外入口。 */}
      <h2 className="text-base font-semibold text-white">价格提醒</h2>

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
                {/* 左栏：标的名独占一行 + 阈值行 + 今日计数（占满剩余宽度）。
                    真机字体比预览宽，名称与阈值挤一行会把「浙商积存金」截成「浙商…」，
                    故拆两行：标的名整行完整显示，阈值+单位另起一行。 */}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {/* 标的名：独占一行，整行宽度足够放下 5~6 字中文名，不再截断 */}
                  <span className="text-sm font-medium text-white">
                    {meta?.shortName ?? rule.instrumentId}
                  </span>
                  {/* 阈值行：方向符 + 阈值 + 单位（核心数据，whitespace-nowrap 不截） */}
                  <span
                    className={`whitespace-nowrap text-sm tabular-nums ${
                      rule.direction === "above" ? "text-rose-400" : "text-emerald-400"
                    }`}
                  >
                    {rule.direction === "above" ? "≥" : "≤"} {fmtPrice(rule.threshold)}
                    {meta?.unit ? <span className="ml-1 text-slate-500">{meta.unit}</span> : null}
                  </span>
                  {/* 今日计数：普通文字（不用胶囊徽章），左对齐 */}
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
