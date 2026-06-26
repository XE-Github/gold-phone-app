"use client";

import { useState } from "react";
import type { Quote } from "@/lib/types";
import { BANK_GOLD_PRODUCTS } from "@/lib/bankProducts";
import { bankSourceBadge, isBankReal, fmtPrice, fmtTime } from "@/lib/display";

type SortKey = "buy" | "spread";

export function BankGoldCompare({
  quotes,
  benchmark,
  realCount,
  total,
}: {
  quotes: Map<string, Quote>;
  benchmark?: number;
  realCount: number;
  total: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("buy");

  const rows = BANK_GOLD_PRODUCTS.map((product) => {
    const q = quotes.get(product.instrumentId);
    // ask = 你买入价（银行卖给你），bid = 你卖出价（银行从你买）
    const buy = q?.ask ?? q?.price;
    const sell = q?.bid;
    const spread = buy != null && sell != null ? Math.round((buy - sell) * 100) / 100 : undefined;
    return { product, q, buy, sell, spread, real: isBankReal(q?.source) };
  });

  // 排序：真实数据优先；同档内按所选键升序（买入价低/点差小更优）。无价排末尾。
  const sorted = [...rows].sort((a, b) => {
    if (a.real !== b.real) return a.real ? -1 : 1;
    const av = sortKey === "buy" ? a.buy : a.spread;
    const bv = sortKey === "buy" ? b.buy : b.spread;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return av - bv;
  });

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">银行积存金对比</h2>
        <span className="text-[11px] text-slate-500">
          真实 {realCount}/{total}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-slate-500">排序：</span>
        <button
          onClick={() => setSortKey("buy")}
          className={`min-h-[32px] rounded-lg px-2.5 ${
            sortKey === "buy" ? "bg-amber-500/20 text-amber-200" : "bg-slate-800/50 text-slate-400"
          }`}
        >
          买入价低→高
        </button>
        <button
          onClick={() => setSortKey("spread")}
          className={`min-h-[32px] rounded-lg px-2.5 ${
            sortKey === "spread"
              ? "bg-amber-500/20 text-amber-200"
              : "bg-slate-800/50 text-slate-400"
          }`}
        >
          点差小→大
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {sorted.map(({ product, q, buy, sell, spread, real }) => {
          const badge = bankSourceBadge(q?.source);
          return (
            <div
              key={product.instrumentId}
              className={`rounded-2xl border px-3 py-3 ${
                real ? "border-emerald-400/15 bg-emerald-400/[0.03]" : "border-white/5 bg-slate-900/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-white">{product.bankName}</span>
                    <span className={`text-[10px] ${badge.cls}`}>●{badge.label}</span>
                  </div>
                  <div className="text-[11px] text-slate-500">{product.product}</div>
                </div>
                <div className="text-right text-[11px] tabular-nums text-slate-500">
                  {fmtTime(q?.timestamp)}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-rose-500/[0.07] py-1.5">
                  <div className="text-[10px] text-slate-400">买入价（你买）</div>
                  <div className="text-sm font-semibold tabular-nums text-rose-200">
                    {buy != null ? `¥${fmtPrice(buy)}` : "--"}
                  </div>
                </div>
                <div className="rounded-xl bg-emerald-500/[0.07] py-1.5">
                  <div className="text-[10px] text-slate-400">卖出价（你卖）</div>
                  <div className="text-sm font-semibold tabular-nums text-emerald-200">
                    {sell != null ? `¥${fmtPrice(sell)}` : "--"}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-700/20 py-1.5">
                  <div className="text-[10px] text-slate-400">点差</div>
                  <div className="text-sm font-semibold tabular-nums text-slate-200">
                    {spread != null ? `¥${fmtPrice(spread)}` : "--"}
                  </div>
                </div>
              </div>

              {!real && (
                <p className="mt-1.5 text-[10px] text-slate-500">
                  ⚠️ 暂未取到该行直连数据，此为基于基准价+已知点差的【估算】，仅供参考。
                </p>
              )}
              {product.instrumentId === "icbc-acc-gold" && q?.bid == null && real && (
                <p className="mt-1.5 text-[10px] text-slate-500">
                  工行官网不暴露赎回价，卖出价/点差不展示（避免伪造 0 点差）。{product.spreadNote}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 space-y-1 text-[11px] text-slate-500">
        {benchmark ? (
          <p>
            基准价 SGE Au99.99 ¥{fmtPrice(benchmark)}/克 ·
            <span className="text-emerald-400/70"> ●官网/京东</span> 真实直连 ·
            <span className="text-sky-300/70"> ●第三方</span> huimiao 聚合（可能延迟） ·
            <span className="text-slate-500"> ●估算</span> 兜底
          </p>
        ) : null}
        <p>
          「买入价」= 银行卖给你、你买入的价；「卖出价」= 银行从你回购、你卖出的价。买卖价差（点差）是持有成本之一。
        </p>
      </div>
    </section>
  );
}
