"use client";

// 银行积存金对比卡（移动端统一规范）：外壳 rounded-2xl p-4 · 行子卡 rounded-xl p-3
//   字号阶梯：text-[11px](来源/时间/单位) / text-sm(银行名) / text-base(标题、价格)。

import type { Quote } from "@/lib/types";
import { BANK_GOLD_PRODUCTS } from "@/lib/bankProducts";
import { bankSourceBadge, fmtPrice, fmtTime } from "@/lib/display";

export function BankGoldCompare({
  quotes,
  realCount,
  total,
}: {
  quotes: Map<string, Quote>;
  realCount: number;
  total: number;
}) {
  // 仅展示：标的、数据源、价格、刷新时间。按买入价升序（无价排末尾）。
  const rows = BANK_GOLD_PRODUCTS.map((product) => {
    const q = quotes.get(product.instrumentId);
    const price = q?.ask ?? q?.price; // 你买入价
    return { product, q, price };
  }).sort((a, b) => {
    if (a.price == null && b.price == null) return 0;
    if (a.price == null) return 1;
    if (b.price == null) return -1;
    return a.price - b.price;
  });

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">银行积存金对比</h2>
        <span className="shrink-0 text-[11px] text-slate-500">
          真实 {realCount}/{total}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {rows.map(({ product, q, price }) => {
          const badge = bankSourceBadge(q?.source);
          return (
            <div
              key={product.instrumentId}
              className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-slate-900/40 p-3"
            >
              {/* 标的 + 数据源 */}
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{product.bankName}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className={`shrink-0 text-[11px] ${badge.cls}`}>●{badge.label}</span>
                  <span className="truncate text-[11px] text-slate-600">{fmtTime(q?.timestamp)}</span>
                </div>
              </div>

              {/* 价格 */}
              <div className="shrink-0 text-right">
                <div className="text-base font-semibold tabular-nums text-amber-100">
                  {price != null ? `¥${fmtPrice(price)}` : "--"}
                </div>
                <div className="text-[11px] text-slate-500">元/克</div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
