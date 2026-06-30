"use client";

// 主价卡（移动端统一尺寸规范，详见各卡顶部约定）：
//   外壳 rounded-2xl p-4 · 标题 text-base · hero 主价 text-3xl · 锚价数值 text-xl
//   字号只用阶梯：text-[11px](辅助/徽章) / text-sm(正文) / text-base(标题) / text-xl / text-3xl
//   红涨绿跌（涨=rose红，跌=emerald绿）不可改。

import type { Quote } from "@/lib/types";
import {
  QUOTE_METAS,
  changeView,
  changeColorClass,
  currencySymbolForId,
  fmtPrice,
  fmtTime,
  freshnessBadge,
} from "@/lib/display";

// 国际锚价 + 国内基准网格（2×2）。label 用本地文案（如 AU9999·SGE），digits 按标的精度。
const GRID = [
  { id: "xau-usd", label: "伦敦金", digits: 2 },
  { id: "usd-cny", label: "美元汇率", digits: 4 },
  { id: "sge-au9999", label: "AU9999·SGE", digits: 2 },
  { id: "gold-etf-518880", label: "518880 ETF", digits: 2 },
] as const;

export function HeroPrice({
  quotes,
  serverTime,
}: {
  quotes: Map<string, Quote>;
  serverTime: number | null;
}) {
  const hero = QUOTE_METAS[0]; // 人民币理论金价 xau-cny
  const heroQuote = quotes.get(hero.instrumentId);
  // 涨跌取 xau-cny 自身：涨跌额已在 computed.ts 按汇率换算成人民币（带 ¥），
  // 涨跌幅复用伦敦金（换算后比值不变，数学精确）。与上方 ¥ 主价单位一致。
  const heroChange = changeView(heroQuote, "¥");

  const timeStr = serverTime
    ? new Date(serverTime).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  return (
    <section className="rounded-2xl border border-amber-400/20 bg-gradient-to-b from-amber-500/[0.12] to-white/[0.03] p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-sm text-amber-200/80">{hero.name}</span>
        {/* 时效徽章：准实时（与主程序一致，绿点脉冲） */}
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          准实时
        </span>
      </div>

      <div className="mt-2 flex items-end gap-2">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-white">
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

      <p className="mt-1 text-[11px] text-slate-500">
        更新于 {timeStr} · {hero.hint}
      </p>

      {/* 国际锚价 + 国内基准：2 列网格 4 张卡（2×2），子卡比外壳小一级（rounded-xl）。
          每卡：名称 + 时效徽章 / 实时价（带计价符号）/ 当日涨跌额(带¥/$)+涨跌幅 / 刷新时间 */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {GRID.map((item) => {
          const q = quotes.get(item.id);
          const symbol = currencySymbolForId(item.id);
          const cv = changeView(q, symbol);
          const fresh = freshnessBadge(q?.source);
          return (
            <div
              key={item.id}
              className="min-w-0 rounded-xl border border-white/5 bg-slate-900/40 p-3"
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="truncate text-[11px] text-slate-400">{item.label}</span>
                <span className={`shrink-0 text-[11px] ${fresh.cls}`}>{fresh.label}</span>
              </div>
              <div className="mt-1 truncate text-xl font-semibold tabular-nums text-white">
                {q ? `${symbol}${fmtPrice(q.price, item.digits)}` : "--"}
              </div>
              {cv ? (
                <div className={`mt-0.5 truncate text-[11px] tabular-nums ${changeColorClass(cv.up)}`}>
                  {cv.text}
                </div>
              ) : (
                <div className="mt-0.5 text-[11px] text-slate-600">涨跌暂无</div>
              )}
              <div className="mt-0.5 text-[10px] tabular-nums text-slate-600">
                {q ? fmtTime(q.timestamp) : "--:--:--"}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
