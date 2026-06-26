"use client";

import type { Quote } from "@/lib/types";
import {
  QUOTE_METAS,
  QUICK_METAS,
  changeView,
  changeColorClass,
  fmtPrice,
  fmtTime,
} from "@/lib/display";

export function HeroPrice({ quotes }: { quotes: Map<string, Quote> }) {
  const hero = QUOTE_METAS[0]; // 人民币理论金价
  const heroQuote = quotes.get(hero.instrumentId);
  const heroChange = changeView(heroQuote);

  return (
    <section className="rounded-3xl border border-amber-400/20 bg-gradient-to-b from-amber-500/[0.12] to-white/[0.03] p-5 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-sm text-amber-200/80">{hero.name}</span>
        <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200/70">
          理论换算价
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

      {(heroQuote?.dayHigh != null || heroQuote?.dayLow != null) && (
        <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
          理论日高 {fmtPrice(heroQuote?.dayHigh)} · 理论日低 {fmtPrice(heroQuote?.dayLow)}
          <span className="text-slate-600">（伦敦金日高低×实时汇率换算）</span>
        </p>
      )}
      <p className="mt-0.5 text-[11px] text-slate-600">
        更新 {fmtTime(heroQuote?.timestamp)} · {hero.hint}
      </p>

      {/* 国际锚价 + 汇率 */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {QUOTE_METAS.slice(1).map((meta) => {
          const q = quotes.get(meta.instrumentId);
          const cv = changeView(q);
          return (
            <div
              key={meta.instrumentId}
              className="rounded-2xl border border-white/5 bg-slate-900/40 px-3 py-2.5"
            >
              <div className="text-[11px] text-slate-400">{meta.shortName}</div>
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

      {/* 国内现货/期货快捷行 */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        {QUICK_METAS.map((meta) => {
          const q = quotes.get(meta.instrumentId);
          const cv = changeView(q);
          return (
            <div
              key={meta.instrumentId}
              className="rounded-2xl border border-white/5 bg-slate-900/40 px-2.5 py-2"
            >
              <div className="truncate text-[11px] text-slate-400">{meta.shortName}</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-amber-100">
                {q ? fmtPrice(q.price) : "--"}
              </div>
              {cv ? (
                <div className={`text-[10px] tabular-nums ${changeColorClass(cv.up)}`}>
                  {cv.text.split(" ")[0]}
                </div>
              ) : (
                <div className="text-[10px] text-slate-600">--</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
