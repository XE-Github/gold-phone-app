"use client";

// 主价卡（移动端统一字号系统，详见 README 字号档表）：
//   外壳 rounded-2xl p-4 · 标题 text-base · hero 主价 text-[28px] · 子卡价格 text-lg
//   字号档位：text-[13px](辅助/徽章/时间/单位) / text-sm(正文) / text-base(标题) / text-lg(价格) / text-[28px](主价)
//   红涨绿跌（涨=rose红，跌=emerald绿）不可改。
//   ⚠️ 核心数据（价格/汇率）绝不可被 truncate 截断——子卡价用 whitespace-nowrap 护不截。
//   ⚠️ 时效徽章走 freshnessBadge(诚实)：xau-cny 是理论换算价→"理论值"，非"实时"。

import type { Quote } from "@/lib/types";
import {
  QUOTE_METAS,
  changeView,
  changeColorClass,
  currencySymbolForId,
  fmtPrice,
  fmtTime,
  metaFor,
} from "@/lib/display";
import { FreshnessBadge } from "./FreshnessBadge";

// 国际锚价 + 国内基准网格（2×2）。label 用本地文案（如 AU9999·SGE），digits 按标的精度。
const GRID = [
  { id: "xau-usd", label: "伦敦金", digits: 2 },
  { id: "usd-cny", label: "美元汇率", digits: 4 },
  { id: "sge-au9999", label: "AU9999·SGE", digits: 2 },
  { id: "gold-etf-518880", label: "518880 ETF", digits: 2 },
] as const;

export function HeroPrice({
  quotes,
}: {
  quotes: Map<string, Quote>;
}) {
  const hero = QUOTE_METAS[0]; // 人民币理论金价 xau-cny
  const heroQuote = quotes.get(hero.instrumentId);
  // 涨跌取 xau-cny 自身：涨跌额已在 computed.ts 按汇率换算成人民币（带 ¥），
  // 涨跌幅复用伦敦金（换算后比值不变，数学精确）。与上方 ¥ 主价单位一致。
  const heroChange = changeView(heroQuote, "¥");

  return (
    <section className="rounded-2xl border border-amber-400/20 bg-gradient-to-b from-amber-500/[0.12] to-white/[0.03] p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-sm text-amber-200/80">{hero.name}</span>
        {/* 时效徽章统一走 FreshnessBadge（诚实）：xau-cny→"理论值"，圆点不呼吸（非实时） */}
        <FreshnessBadge source={heroQuote?.source} variant="pill" />
      </div>

      <div className="mt-2 flex items-end gap-2">
        <span className="text-[28px] font-bold tabular-nums tracking-tight text-white">
          {heroQuote ? `¥${fmtPrice(heroQuote.price)}` : "--"}
        </span>
        <span className="pb-1 text-[13px] text-slate-400">{hero.unit}</span>
      </div>

      {heroChange ? (
        <p className={`mt-1 text-sm tabular-nums ${changeColorClass(heroChange.up)}`}>
          {heroChange.text}
        </p>
      ) : (
        <p className="mt-1 text-sm text-slate-500">涨跌数据暂无</p>
      )}

      {/* 国际锚价 + 国内基准：2 列网格 4 张卡（2×2），子卡比外壳小一级（rounded-xl）。
          每卡：名称 + 时效徽章 / 实时价（带计价符号）/ 当日涨跌额(带¥/$)+涨跌幅 / 刷新时间 */}
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        {GRID.map((item) => {
          const q = quotes.get(item.id);
          const symbol = currencySymbolForId(item.id);
          const unit = metaFor(item.id)?.unit; // 汇率为空串→不显单位；其余显「美元/盎司」「元/克」「元/份」
          const cv = changeView(q, symbol);
          return (
            <div
              key={item.id}
              className="min-w-0 rounded-xl border border-white/5 bg-slate-900/40 p-3"
            >
              <div className="flex items-center justify-between gap-1.5">
                {/* 名称可截断（非核心数据），徽章不截。徽章统一走 FreshnessBadge（带圆点+按实时性呼吸） */}
                <span className="truncate text-[13px] text-slate-400">{item.label}</span>
                <FreshnessBadge source={q?.source} variant="inline" />
              </div>
              {/* 核心：价格/汇率绝不截断——whitespace-nowrap 护不截，text-lg 在 ~179px 列宽放得下。
                  单位（元/克·美元/盎司·元/份）紧跟价格后，辅助档 text-[13px]；汇率无单位则不显。 */}
              <div className="mt-1 flex items-baseline gap-1 whitespace-nowrap">
                <span className="text-lg font-semibold tabular-nums text-white">
                  {q ? `${symbol}${fmtPrice(q.price, item.digits)}` : "--"}
                </span>
                {unit ? <span className="text-[13px] text-slate-500">{unit}</span> : null}
              </div>
              {cv ? (
                <div className={`mt-0.5 whitespace-nowrap text-[13px] tabular-nums ${changeColorClass(cv.up)}`}>
                  {cv.text}
                </div>
              ) : (
                <div className="mt-0.5 text-[13px] text-slate-600">涨跌暂无</div>
              )}
              <div className="mt-0.5 text-[13px] tabular-nums text-slate-600">
                {q ? fmtTime(q.timestamp) : "--:--:--"}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
