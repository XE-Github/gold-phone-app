// 时效徽章（全局统一）：实时 / 近实时 / 最新牌价 / 理论值 / 估算 / 延时。
// 单一事实源 = display.ts 的 freshnessBadge(source)：label/颜色/圆点/是否呼吸均由它决定。
//   live=true（实时类）→ 圆点 animate-pulse（在动）；live=false（理论值/估算/延时）→ 圆点不呼吸（诚实，不假装实时）。
// 两种形态：
//   variant="pill"   带胶囊背景，用于主价卡 / 趋势图标题（醒目）。
//   variant="inline" 仅圆点+文字，用于 HeroPrice 2×2 子卡（紧凑）。
// 所有徽章都带圆点——之前子卡缺圆点导致「有些徽标没有呼吸效果」，本组件统一修齐。

import { freshnessBadge } from "@/lib/display";

export function FreshnessBadge({
  source,
  variant = "inline",
  className = "",
}: {
  source?: string;
  variant?: "pill" | "inline";
  className?: string;
}) {
  const fresh = freshnessBadge(source);
  const dot = (
    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${fresh.dot} ${fresh.live ? "animate-pulse" : ""}`} />
  );

  if (variant === "pill") {
    return (
      <span
        className={`flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-1 text-[13px] ${fresh.cls} ${className}`}
      >
        {dot}
        {fresh.label}
      </span>
    );
  }

  return (
    <span className={`flex shrink-0 items-center gap-1 text-[13px] ${fresh.cls} ${className}`}>
      {dot}
      {fresh.label}
    </span>
  );
}
