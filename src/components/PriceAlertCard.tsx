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
    onAdd({ instrumentId, direction, threshold, enabled: true, sound });
    setThresholdStr("");
    void onRequestPermission();
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">价格提醒</h2>
        <button
          onClick={enableNotify}
          disabled={perm === "granted" || perm === "unsupported"}
          className={`min-h-9 shrink-0 rounded-lg px-3 text-[11px] font-medium disabled:opacity-60 ${notifyBtn.cls}`}
        >
          {notifyBtn.text}
        </button>
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
        <label className="flex items-center gap-2 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => setSound(e.target.checked)}
            className="h-4 w-4 accent-amber-500"
          />
          触发时播放提示音（需先与页面交互一次浏览器才允许出声）
        </label>

        {/* 被拒绝时给可操作步骤：denied 后浏览器不再弹请求框，必须手动到站点设置改回（仅 Web） */}
        {!native && perm === "denied" && (
          <div className="rounded-xl border border-rose-400/20 bg-rose-500/[0.08] p-2.5 text-[11px] leading-relaxed text-rose-100/90">
            <p className="font-semibold text-rose-200">通知已被浏览器屏蔽，按钮无法再弹出请求框</p>
            <p className="mt-1 text-rose-100/80">
              这是浏览器记住了本站点的「拒绝」，需手动改回：点地址栏左侧 🔒/ⓘ →「通知」→ 改为「允许」，
              再回来刷新页面。（手机系统的浏览器通知总开关也要开着）
            </p>
          </div>
        )}

        {/* 提示文案：原生壳与 Web 分流（原生无浏览器/添加主屏概念） */}
        {native ? (
          <p className="text-[11px] leading-relaxed text-slate-500">
            ⚠️ 提醒在 App 打开/前台时监控；首次需点上方「开启系统通知」并在系统弹窗允许。
            后台被系统杀死后会停止监控，可在系统设置里给本 App「免后台限制/自启动」缓解。
          </p>
        ) : (
          <p className="text-[11px] leading-relaxed text-slate-500">
            ⚠️ 系统通知需先点上方「开启系统通知」并允许。手机上仅在本页面打开时监控；
            若收不到弹窗，请到手机「浏览器/系统通知设置」确认已允许，部分浏览器需先「添加到主屏幕」。
          </p>
        )}
        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>

      {/* 规则列表：子卡 rounded-xl，内联按钮 min-h-9(36px) 且间距 ≥8px */}
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
            return (
              <div
                key={rule.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/40 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">
                    {meta?.shortName ?? rule.instrumentId}{" "}
                    <span className={rule.direction === "above" ? "text-rose-400" : "text-emerald-400"}>
                      {rule.direction === "above" ? "≥" : "≤"} {fmtPrice(rule.threshold)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {rule.sound ? "🔔 有声" : "🔕 静音"} · {meta?.unit}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => onToggle(rule.id)}
                    className={`min-h-9 rounded-lg px-3 text-[11px] font-medium ${
                      rule.enabled
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-slate-700/40 text-slate-400"
                    }`}
                  >
                    {rule.enabled ? "启用中" : "已停用"}
                  </button>
                  <button
                    onClick={() => onRemove(rule.id)}
                    className="min-h-9 rounded-lg bg-rose-500/10 px-3 text-[11px] font-medium text-rose-300"
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
