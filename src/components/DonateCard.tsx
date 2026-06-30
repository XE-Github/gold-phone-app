"use client";

// 捐赠卡片（「我的」Tab）：纯展示，无数据依赖。
//   - 微信/支付宝两张真实收款码（public/donate/*，已核验为作者本人码：微信「贾可（Leon）」、支付宝「阿可」）。
//   - 两张原图自带品牌头+收款人名，这里不再额外加品牌标识，避免重复。
//   - 诚实约定：自愿、不影响任何功能；不臆造金额、不诱导。
//   尺寸：用各自原图宽高比（wechat 1461×1989、alipay 1080×1620）占位防 CLS（image-dimension）。
//   静态导出未用 next/image（next.config images.unoptimized），直接 <img> 即可。

const CODES = [
  { key: "wechat", label: "微信", src: "donate/wechat.png", w: 1461, h: 1989 },
  { key: "alipay", label: "支付宝", src: "donate/alipay.jpg", w: 1080, h: 1620 },
] as const;

export function DonateCard() {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
      <h2 className="text-base font-semibold text-white">捐赠</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-slate-400">
        如果这个小工具帮到你，欢迎请作者喝杯咖啡 ☕
        <span className="text-slate-500">（完全自愿）。</span>
      </p>

      <div className="mt-4 space-y-4">
        {CODES.map((c) => (
          <figure key={c.key} className="flex flex-col items-center">
            {/* 限制最大宽度并居中；用原图宽高比占位防止加载时布局跳动。
                静态导出 images.unoptimized，next/image 的服务端优化无意义，刻意用 <img>。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.src}
              alt={`${c.label}收款码`}
              width={c.w}
              height={c.h}
              loading="lazy"
              decoding="async"
              className="w-full max-w-[240px] rounded-xl border border-white/10 bg-white"
              style={{ aspectRatio: `${c.w} / ${c.h}` }}
            />
            <figcaption className="mt-2 text-[13px] text-slate-500">
              {c.label}扫码
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
