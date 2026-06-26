"use client";

// 国际黄金-实时趋势图（从主程序 TrendLineChart 的「国际黄金-实时视图」搬来，手机适配）。
//
// 口径与主程序完全一致：
//   - 两条线：伦敦金 XAU/USD（右轴 $/盎司，琥珀）+ 国内理论金价 XAU/CNY（左轴 ¥/克，蓝）
//   - 时区 = 真实 UTC（图表轴即国际时间），formatCN 中文时间标签
//   - 历史来自本机 tick 缓冲（/api/history），右端用 series.update 追加「当前分钟」实时点
//   - 真实日内高/低水平线来自 xau-usd 的 dayHigh/dayLow（行情源提供的真实值）
//   - 仅展示有数据的线；缓冲为空时显示「等待采集」，绝不画估算线
//
// 与主程序差异：手机只保留这一个视图（无 市场/时间范围 切换），布局竖向紧凑。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type LineData,
  type Time,
  type TickMarkType,
  ColorType,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";
import type { Quote } from "@/lib/types";
import { nowUtcMinute } from "@/lib/chartTime";

/** 时间轴中文标签（真实 UTC，用 getUTC* 取分量） */
function formatCN(time: Time, tickMarkType: TickMarkType): string | null {
  const ts = (typeof time === "number" ? time : 0) * 1000;
  if (!ts) return null;
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  switch (tickMarkType) {
    case 0: // Year
      return `${d.getUTCFullYear()}`;
    case 1: // Month
      return `${d.getUTCMonth() + 1}月`;
    case 2: // DayOfMonth
      return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    case 3: // Time
    case 4: // TimeWithSeconds
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    default:
      return null;
  }
}

interface SeriesDef {
  instrumentId: string;
  label: string;
  color: string;
  rightAxis: boolean; // true=右轴($/oz)，false=左轴(¥/g)
}

const SERIES_DEFS: SeriesDef[] = [
  { instrumentId: "xau-usd", label: "伦敦金 $/oz", color: "#fbbf24", rightAxis: true },
  { instrumentId: "xau-cny", label: "理论金价 ¥/g", color: "#60a5fa", rightAxis: false },
];

const IN_VIEW = ["xau-usd", "xau-cny"];

/** 未来时间引导点：从 lastTime 起按 spacing 生成 count 个不可见点，强制时间轴显示未来标签 */
function buildGuidePoints(lastTime: number, spacing: number, count: number): LineData[] {
  const pts: LineData[] = [];
  for (let i = 1; i <= count; i++) {
    pts.push({ time: (lastTime + spacing * i) as Time, value: 0 });
  }
  return pts;
}

export function TrendChart({ quotes }: { quotes: Map<string, Quote> }) {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesMapRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  const guideRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<{ high: IPriceLine | null; low: IPriceLine | null }>({
    high: null,
    low: null,
  });
  const lastHLRef = useRef<{ high?: number; low?: number }>({});
  const isDisposed = useRef(false);
  const [chartEpoch, setChartEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [hasData, setHasData] = useState(false);
  const [legendPrices, setLegendPrices] = useState<Record<string, number>>({});

  // callback ref：节点挂载/卸载（含 HMR 重建 div）都触发，自动重建图表。
  const attachChart = useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      isDisposed.current = true;
      try {
        chartRef.current?.remove();
      } catch {
        /* ignore */
      }
      chartRef.current = null;
      seriesMapRef.current.clear();
      guideRef.current = null;
      return;
    }

    isDisposed.current = false;
    const chart = createChart(node, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.05)" },
        horzLines: { color: "rgba(255,255,255,0.05)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(251,191,36,0.3)", width: 1, style: 2, labelBackgroundColor: "#fbbf24" },
        horzLine: { color: "rgba(251,191,36,0.3)", width: 1, style: 2, labelBackgroundColor: "#fbbf24" },
      },
      leftPriceScale: {
        visible: true,
        borderColor: "rgba(96,165,250,0.25)",
        scaleMargins: { top: 0.12, bottom: 0.18 },
        minimumWidth: 44,
      },
      rightPriceScale: {
        visible: true,
        borderColor: "rgba(251,191,36,0.25)",
        scaleMargins: { top: 0.12, bottom: 0.18 },
        minimumWidth: 44,
      },
      timeScale: {
        borderColor: "rgba(255,255,255,0.1)",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: formatCN,
        rightOffset: 4,
        shiftVisibleRangeOnNewBar: true,
        minBarSpacing: 3,
      },
      handleScale: { mouseWheel: true, pinch: true, axisDoubleClickReset: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      autoSize: true,
      width: node.clientWidth || 360,
      height: 280,
    });
    chartRef.current = chart;

    for (const def of SERIES_DEFS) {
      const series = chart.addSeries(LineSeries, {
        color: def.color,
        lineWidth: 2,
        priceScaleId: def.rightAxis ? "right" : "left",
        visible: false,
        lastValueVisible: def.rightAxis,
        priceLineVisible: false,
      });
      seriesMapRef.current.set(def.instrumentId, series);
    }

    // 未来时间引导（独立不可见刻度，不影响左右轴量程）
    const guide = chart.addSeries(LineSeries, {
      color: "rgba(0,0,0,0)",
      lineWidth: 1,
      priceScaleId: "future-guide",
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    chart.priceScale("future-guide").applyOptions({ visible: false });
    guideRef.current = guide;

    setChartEpoch((e) => e + 1);
  }, []);

  // 加载历史（首次挂载 / HMR 重建后触发）。每 60s 也复拉一次以补齐分钟桶。
  useEffect(() => {
    if (isDisposed.current) return;
    let cancelled = false;

    async function load(showLoading: boolean) {
      if (showLoading) setLoading(true);
      try {
        const res = await fetch("/api/history", { cache: "no-store" });
        if (cancelled || isDisposed.current || !res.ok) return;
        const json = (await res.json()) as {
          series: Record<string, { time: number; value: number }[]>;
          sources: Record<string, string>;
        };
        if (cancelled || isDisposed.current) return;

        let anyData = false;
        const nextLegend: Record<string, number> = {};
        for (const def of SERIES_DEFS) {
          const series = seriesMapRef.current.get(def.instrumentId);
          if (!series) continue;
          const data = json.series?.[def.instrumentId] ?? [];
          if (data.length > 0) {
            anyData = true;
            series.setData(data.map((p) => ({ time: p.time as Time, value: p.value })));
            series.applyOptions({ visible: true });
            const last = data[data.length - 1];
            if (last?.value > 0) nextLegend[def.instrumentId] = last.value;
          } else {
            series.setData([]);
            series.applyOptions({ visible: false });
          }
        }
        setHasData(anyData);
        setLegendPrices(nextLegend);

        // 未来引导：从最后数据点起 60s 间隔 30 个点
        if (guideRef.current) {
          let lastTime = 0;
          for (const id of IN_VIEW) {
            const d = seriesMapRef.current.get(id)?.data();
            if (d && d.length > 0) {
              const lt = d[d.length - 1].time as number;
              if (lt > lastTime) lastTime = lt;
            }
          }
          guideRef.current.setData(lastTime > 0 ? buildGuidePoints(lastTime, 60, 30) : []);
        }
        chartRef.current?.timeScale().fitContent();
        chartRef.current?.timeScale().scrollToRealTime();
        setHistoryLoaded(true);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled && !isDisposed.current && showLoading) setLoading(false);
      }
    }

    void load(true);
    const timer = window.setInterval(() => void load(false), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [chartEpoch]);

  // 实时：右端追加「当前分钟」点，价格随 quote 跳动（真实 UTC 分钟桶）
  useEffect(() => {
    if (!historyLoaded || isDisposed.current) return;
    const t = nowUtcMinute();
    const nextLegend: Record<string, number> = {};
    for (const id of IN_VIEW) {
      const q = quotes.get(id);
      const series = seriesMapRef.current.get(id);
      // 只更新已有历史数据的线，避免给空线画孤立浮动点
      if (q && q.price > 0 && series && series.data().length > 0) {
        try {
          series.update({ time: t as Time, value: q.price });
          nextLegend[id] = q.price;
        } catch {
          /* 时间顺序冲突，忽略 */
        }
      }
    }
    if (Object.keys(nextLegend).length > 0) {
      queueMicrotask(() => setLegendPrices((prev) => ({ ...prev, ...nextLegend })));
    }
    if (guideRef.current) {
      guideRef.current.setData(buildGuidePoints(t, 60, 30));
    }
  }, [quotes, historyLoaded]);

  // 真实日内高/低水平线（来自 xau-usd 的 dayHigh/dayLow）
  useEffect(() => {
    if (!historyLoaded || isDisposed.current) return;
    const series = seriesMapRef.current.get("xau-usd");
    const quote = quotes.get("xau-usd");
    const high = quote?.dayHigh;
    const low = quote?.dayLow;

    if (lastHLRef.current.high === high && lastHLRef.current.low === low) return;

    if (series) {
      if (priceLinesRef.current.high) {
        try {
          series.removePriceLine(priceLinesRef.current.high);
        } catch {
          /* 已随 chart 移除 */
        }
      }
      if (priceLinesRef.current.low) {
        try {
          series.removePriceLine(priceLinesRef.current.low);
        } catch {
          /* 已随 chart 移除 */
        }
      }
    }
    priceLinesRef.current = { high: null, low: null };

    if (series && high != null && high > 0) {
      try {
        priceLinesRef.current.high = series.createPriceLine({
          price: high,
          color: "#fbbf24",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "真实日高",
        });
      } catch {
        /* ignore */
      }
    }
    if (series && low != null && low > 0) {
      try {
        priceLinesRef.current.low = series.createPriceLine({
          price: low,
          color: "#fbbf24",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "真实日低",
        });
      } catch {
        /* ignore */
      }
    }
    lastHLRef.current = { high, low };
  }, [quotes, historyLoaded, chartEpoch]);

  const xauUsd = quotes.get("xau-usd");

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">趋势图 · 国际黄金实时</h2>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          UTC 实时
        </span>
      </div>

      {/* 紧凑图例：两条线 + 当前价 */}
      <div className="mt-2 flex flex-wrap gap-2">
        {SERIES_DEFS.map((def) => {
          const live = quotes.get(def.instrumentId)?.price;
          const price = live != null && live > 0 ? live : legendPrices[def.instrumentId];
          return (
            <span
              key={def.instrumentId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-900/40 px-2 py-1 text-[11px]"
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: def.color }} />
              <span className="text-slate-300">{def.label}</span>
              {price != null && price > 0 && (
                <span className="tabular-nums font-semibold" style={{ color: def.color }}>
                  {def.rightAxis ? `$${price.toFixed(2)}` : `¥${price.toFixed(2)}`}
                </span>
              )}
            </span>
          );
        })}
      </div>

      <div className="relative mt-2">
        {/* 轴单位提示 */}
        <div className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-slate-950/40 px-1.5 py-0.5 text-[10px] font-medium text-sky-300/80">
          ¥/克
        </div>
        <div className="pointer-events-none absolute right-1 top-1 z-10 rounded bg-slate-950/40 px-1.5 py-0.5 text-[10px] font-medium text-amber-300/80">
          $/盎司
        </div>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-slate-950/60">
            <div className="rounded-xl border border-white/10 bg-slate-950/80 px-4 py-3 text-sm text-slate-300">
              加载实时分时…
            </div>
          </div>
        )}
        {!loading && !hasData && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl border border-dashed border-white/10 bg-slate-950/50 px-6 text-center">
            <div>
              <p className="text-sm font-medium text-slate-200">暂无分时数据</p>
              <p className="mt-1 text-xs text-slate-500">
                分时接口暂不可达（非交易时段或网络问题），稍后自动重试。
              </p>
            </div>
          </div>
        )}
        <div
          ref={attachChart}
          className="h-[280px] w-full rounded-2xl"
          role="img"
          aria-label="国际黄金实时趋势图：伦敦金与人民币理论金价"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-600">
        <span className="rounded bg-slate-900/70 px-1.5 py-0.5 text-slate-500">UTC</span>
        <span className="flex-1">· 伦敦金当日分时（新浪国际期货，UTC时间）+ 人民币理论金价（按当前汇率换算），右端追加实时点</span>
        {xauUsd?.dayHigh != null && xauUsd.dayLow != null && (
          <span
            className="shrink-0 tabular-nums text-slate-400"
            title="美元高低来自新浪 hf_XAU 实时报价；折线为本应用采集样本，可能未覆盖高低发生时刻。"
          >
            真实日内 高 <span className="text-rose-300">${xauUsd.dayHigh.toFixed(2)}</span>
            {" / "}低 <span className="text-emerald-300">${xauUsd.dayLow.toFixed(2)}</span>
          </span>
        )}
      </div>
    </section>
  );
}
