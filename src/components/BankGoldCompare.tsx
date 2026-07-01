"use client";

// 银行积存金对比卡（移动端统一字号系统，详见 README 字号档表）：外壳 rounded-2xl p-4 · 行子卡 rounded-xl p-3
//   两行布局（375px 单行会把银行名截成「工…」，故保留两行）：
//     第一行：银行名(可截) + 时效徽章(圆点按 live 呼吸) ←→ 价格 + 单位（核心数据不截）
//     第二行：●数据源徽章 + 时间
//   字号档位：text-[13px](来源/时效/时间/单位) / text-sm(银行名) / text-base(标题) / text-lg(价格)。
//   ⚠️ 时间(HH:MM:SS)与价格均不截断——whitespace-nowrap 护不截；仅银行名可截（min-w-0 truncate）。

import type { Quote } from "@/lib/types";
import { BANK_GOLD_PRODUCTS } from "@/lib/bankProducts";
import { bankSourceBadge, freshnessBadge, fmtPrice, fmtTime, staleState } from "@/lib/display";

// 积存金流「卡住/出错」阈值：>120s（积存金正常 3s 一帧，比行情宽，且银行牌价夜间本就稀疏）。
const BANK_STALE_MS = 120_000;

export function BankGoldCompare({
  quotes,
  updatedAt,
  error,
  now,
}: {
  quotes: Map<string, Quote>;
  // 区段级时效诚实条（问题 3）。全可选→旧调用/首帧前不显条，行为与从前一致。
  updatedAt?: number;
  error?: string;
  now?: number | null;
}) {
  const stale =
    now != null ? staleState(updatedAt, error, now, BANK_STALE_MS) : { stale: false as const };
  // 仅展示：标的、数据源、价格、刷新时间。按 BANK_GOLD_PRODUCTS 数组顺序（用户指定，不再价格排序）。
  const rows = BANK_GOLD_PRODUCTS.map((product) => {
    const q = quotes.get(product.instrumentId);
    const price = q?.ask ?? q?.price; // 你买入价
    return { product, q, price };
  });

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
      <h2 className="text-base font-semibold text-white">积存金</h2>

      {/* 区段级诚实条（问题 3）：整条积存金流卡住/失败时明说，不拿旧牌价假装最新。 */}
      {stale.stale && (
        <div
          role="status"
          className={`mt-2 rounded-lg border px-2.5 py-1.5 text-[13px] leading-snug ${
            stale.reason === "error"
              ? "border-rose-400/25 bg-rose-500/[0.08] text-rose-200/90"
              : "border-amber-400/25 bg-amber-500/[0.08] text-amber-200/90"
          }`}
        >
          {stale.reason === "error"
            ? "更新失败，正在重试（下方为上次牌价）"
            : `牌价可能过时（已 ${stale.ageSec ?? "?"}s 未更新）`}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {rows.map(({ product, q, price }) => {
          const badge = bankSourceBadge(q?.source); // 数据源（官网直连/京东平台/第三方聚合/估算）
          const fresh = freshnessBadge(q?.source);  // 时效（最新牌价/估算），圆点按 live 呼吸
          return (
            <div
              key={product.instrumentId}
              className="rounded-xl border border-white/5 bg-slate-900/40 p-3"
            >
              {/* 第一行：银行名(可截) + 时效徽章(紧跟银行名) ←→ 价格 + 单位（核心数据不截）。
                  整行 items-center：价格组在行内上下居中（¥大字与单位垂直居中对齐）。 */}
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm font-medium text-white">
                    {product.bankName}
                  </span>
                  {/* 时效徽章：圆点(按 live 呼吸=活的实时) + 文案，与主价卡/子卡同套语义 */}
                  <span className={`flex shrink-0 items-center gap-1 text-[13px] ${fresh.cls}`}>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${fresh.dot} ${fresh.live ? "animate-pulse" : ""}`} />
                    {fresh.label}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                  <span className="text-lg font-semibold tabular-nums text-amber-100">
                    {price != null ? `¥${fmtPrice(price)}` : "--"}
                  </span>
                  <span className="text-[13px] text-slate-500">元/克</span>
                </span>
              </div>

              {/* 第二行：数据源徽章 + 时间 */}
              <div className="mt-1 flex items-center gap-2">
                <span className={`shrink-0 text-[13px] ${badge.cls}`}>●{badge.label}</span>
                {/* 时间固定格式 HH:MM:SS，不截断 */}
                <span className="shrink-0 whitespace-nowrap text-[13px] tabular-nums text-slate-600">
                  {fmtTime(q?.timestamp)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
