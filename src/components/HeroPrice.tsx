"use client";

import type { Quote } from "@/lib/types";
import {
  QUOTE_METAS,
  changeView,
  changeColorClass,
  fmtPrice,
  freshnessBadge,
} from "@/lib/display";

export function HeroPrice({
  quotes,
  serverTime,
}: {
  quotes: Map<string, Quote>;
  serverTime: number | null;
}) {
  const hero = QUOTE_METAS[0]; // 人民币理论金价 xau-cny
  const heroQuote = quotes.get(hero.instrumentId);
  // 涨跌口径与主程序一致：xau-cny 自身无真实昨收，涨跌幅借用伦敦金(xau-usd)。
  const xauUsd = quotes.get("xau-usd");
  const heroChange = changeView(xauUsd);

  const timeStr = serverTime
    ? new Date(serverTime).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  return (
    <section className="rounded-3xl border border-amber-400/20 bg-gradient-to-b from-amber-500/[0.12] to-white/[0.03] p-5 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-sm text-amber-200/80">{hero.name}</span>
        {/* 时效徽章：准实时（与主程序一致，绿点脉冲） */}
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          准实时
        </span>
      </div>

      <div className="mt-1.5 flex items-end gap-2">
        <span className="text-4xl font-bold tabular-nums tracking-tight text-white">
          {heroQuote ? `¥${fmtPrice(heroQuote.price)}` : "--"}
        </span>
        <span className="pb-1 text-sm text-slate-400">{hero.unit}</span>
      </div>

      {heroChange ? (
        <p className={`mt-1 text-sm tabular-nums ${changeColorClass(heroChange.up)}`}>
          {heroChange.text}
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500">涨跌数据暂无</p>
      )}

      <p className="mt-1 text-[11px] text-slate-600">
        更新于 {timeStr} · {hero.hint}
      </p>

      {/* 国际锚价 + 汇率 */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {QUOTE_METAS.slice(1).map((meta) => {
          const q = quotes.get(meta.instrumentId);
          const cv = changeView(q);
          const fresh = freshnessBadge(q?.source);
          return (
            <div
              key={meta.instrumentId}
              className="rounded-2xl border border-white/5 bg-slate-900/40 px-3 py-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">{meta.shortName}</span>
                <span className={`text-[9px] ${fresh.cls}`}>{fresh.label}</span>
              </div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums text-white">
                {q ? fmtPrice(q.price, meta.instrumentId === "usd-cny" ? 4 : 2) : "--"}
              </div>
              {cv ? (
                <div className={`text-[11px] tabular-nums ${changeColorClass(cv.up)}`}>
                  {cv.text}
                </div>
              ) : (
                <div className="text-[11px] text-slate-600">涨跌暂无</div>
              )}
            </div>
          );
        })}
      </div>

    </section>
  );
}
