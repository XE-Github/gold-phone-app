"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Quote } from "@/lib/types";
import { HeroPrice } from "@/components/HeroPrice";
import { TrendChart } from "@/components/TrendChart";
import { PriceAlertCard } from "@/components/PriceAlertCard";
import { AlertToast } from "@/components/AlertToast";
import { BankGoldCompare } from "@/components/BankGoldCompare";
import { UpdateCard } from "@/components/UpdateCard";
import { DonateCard } from "@/components/DonateCard";
import { usePriceAlerts } from "@/lib/usePriceAlerts";
import { subscribeQuotes, type StreamStatus } from "@/lib/quotesStream";
import { BANK_GOLD_PRODUCTS } from "@/lib/bankProducts";
import { DiagPanel } from "@/components/DiagPanel";
import { ConsentGate } from "@/components/ConsentGate";

// 积存金标的 id 集合：SSE 把行情+积存金合并推送，前端按 id 归属拆回两份。
const BANK_IDS = new Set(BANK_GOLD_PRODUCTS.map((p) => p.instrumentId));

function toMap(quotes: Quote[]): Map<string, Quote> {
  const m = new Map<string, Quote>();
  for (const q of quotes) m.set(q.instrumentId, q);
  return m;
}

type Tab = "home" | "mine";

// 默认导出包一层强制同意门：未同意前不渲染主页内容、不订阅任何数据；
// 同意后才渲染 HomeContent 并由 ConsentGate 触发启动埋点（见 ConsentGate / analytics.ts）。
export default function Home() {
  return (
    <ConsentGate>
      <HomeContent />
    </ConsentGate>
  );
}

function HomeContent() {
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [bankQuotes, setBankQuotes] = useState<Map<string, Quote>>(new Map());
  const [bankMeta, setBankMeta] = useState<{ realCount: number; total: number }>({
    realCount: 0,
    total: 0,
  });
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  // 底部 Tab：首页 / 我的。静态导出 + Capacitor 壳内子路由打不开，故两个 Tab 是同页
  // client state 切换（不是 Next 路由）；两个面板都常驻挂载、用 hidden 切显示，避免切回
  // 首页时图表/状态重建闪烁，数据订阅也只建一次、切 Tab 不断流。
  const [tab, setTab] = useState<Tab>("home");
  // 装机诊断：App 内静态导出子路由跳不动，故改为同页全屏弹层打开诊断面板。
  // 入口已从首页 footer 移到「我的」页（由 MineTab 调 onOpenDiag 触发）。
  const [showDiag, setShowDiag] = useState(false);
  const mounted = useRef(true);

  // 价格提醒：监控行情 + 银行积存金价格表（取 price）。
  // 银行积存金的 price=你买入价(ask)，与对比卡片口径一致。
  const priceById = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, q] of quotes) m.set(id, q.price);
    for (const [id, q] of bankQuotes) m.set(id, q.price);
    return m;
  }, [quotes, bankQuotes]);

  const alerts = usePriceAlerts(priceById);

  useEffect(() => {
    mounted.current = true;

    // 行情+积存金：同一条 SSE 推送（对齐主程序——后端行情 2s 循环、积存金 3s 循环，
    // 抓到即推；断线自动降级轮询）。payload 里行情与积存金 quotes 合并，前端按 id 拆回两份。
    // queueMicrotask：把订阅推迟出 effect 同步体，满足 react-hooks/set-state-in-effect。
    let unsubscribe: (() => void) | null = null;
    queueMicrotask(() => {
      unsubscribe = subscribeQuotes(
        (data) => {
          if (!mounted.current) return;
          const market: Quote[] = [];
          const bank: Quote[] = [];
          for (const q of data.quotes) {
            (BANK_IDS.has(q.instrumentId) ? bank : market).push(q);
          }
          setQuotes(toMap(market));
          setBankQuotes(toMap(bank));
          setBankMeta({
            realCount: data.bankRealCount ?? 0,
            total: data.bankTotal ?? bank.length,
          });
          setWarnings(data.warnings ?? []);
          setLastUpdate(data.serverTime);
        },
        (s) => {
          if (mounted.current) setStatus(s);
        },
      );
    });

    return () => {
      mounted.current = false;
      unsubscribe?.();
    };
  }, []);

  return (
    <>
      {/* 顶部吃状态栏安全区（Capacitor edge-to-edge：WebView 画到状态栏下，须留出 --safe-top）；
          底部留 TabBar 高度(4.5rem) + 手势条安全区。 */}
      <main
        className="mx-auto min-h-dvh w-full max-w-md px-4"
        style={{
          paddingBottom: "calc(4.5rem + var(--safe-bottom))",
        }}
      >
        {/* 价格提醒触发的弹窗：提醒功能属首页，但 toast 全局展示、与 Tab 无关 */}
        <AlertToast fired={alerts.fired} onDismiss={alerts.dismissFired} />

        {/* 两个 Tab 都常驻挂载，用 hidden 切换显示（保活：切回不重建图表/不断订阅） */}
        <div className={tab === "home" ? "" : "hidden"}>
          <HomeTab
            quotes={quotes}
            bankQuotes={bankQuotes}
            bankMeta={bankMeta}
            status={status}
            lastUpdate={lastUpdate}
            warnings={warnings}
            alerts={alerts}
            priceById={priceById}
          />
        </div>
        <div className={tab === "mine" ? "" : "hidden"}>
          <MineTab onOpenDiag={() => setShowDiag(true)} />
        </div>
      </main>

      <TabBar tab={tab} onChange={setTab} />

      {/* 装机诊断二级页：与捐赠页同款全屏壳 + 顶部「← 返回」条（统一二级页退出体验），内部独立滚动 */}
      {showDiag && <DiagView onBack={() => setShowDiag(false)} />}
    </>
  );
}

// 吸顶 header：滚动时状态栏区域始终有底色不穿帮；顶部吃 --safe-top 避开状态栏。
function StickyHeader({ children }: { children: React.ReactNode }) {
  return (
    <header
      className="sticky top-0 z-30 -mx-4 mb-3 border-b border-white/5 bg-slate-950/80 px-4 pb-3 backdrop-blur"
      style={{ paddingTop: "calc(var(--safe-top) + 0.75rem)" }}
    >
      {children}
    </header>
  );
}

// 首页 Tab：模块顺序 = 人民币理论金价 → 提醒 → 积存金 → 趋势图（用户指定）。
function HomeTab({
  quotes,
  bankQuotes,
  bankMeta,
  status,
  lastUpdate,
  warnings,
  alerts,
  priceById,
}: {
  quotes: Map<string, Quote>;
  bankQuotes: Map<string, Quote>;
  bankMeta: { realCount: number; total: number };
  status: StreamStatus;
  lastUpdate: number | null;
  warnings: string[];
  alerts: ReturnType<typeof usePriceAlerts>;
  priceById: Map<string, number>;
}) {
  return (
    <>
      <StickyHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white">黄金看板</h1>
          </div>
          <StatusPill status={status} lastUpdate={lastUpdate} />
        </div>
      </StickyHeader>

      {warnings.length > 0 && (
        <div className="mb-3 space-y-0.5 rounded-xl border border-amber-400/20 bg-amber-500/[0.07] p-3 text-[11px] leading-relaxed text-amber-200/80">
          {warnings.map((w, i) => (
            <p key={i}>· {w}</p>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <HeroPrice quotes={quotes} serverTime={lastUpdate} />
        <PriceAlertCard
          rules={alerts.rules}
          hydrated={alerts.hydrated}
          priceById={priceById}
          onAdd={alerts.addRule}
          onRemove={alerts.removeRule}
          onToggle={alerts.toggleRule}
          onRequestPermission={alerts.requestNotificationPermission}
        />
        <BankGoldCompare
          quotes={bankQuotes}
          realCount={bankMeta.realCount}
          total={bankMeta.total}
        />
        <TrendChart quotes={quotes} />
      </div>
    </>
  );
}

// 我的 Tab：列表式入口（移动 App 标准「我的」长相）。
//   - 检查更新：保留卡片直接展开（本就是一键操作）。
//   - 捐赠 / 装机诊断：列表行，点进二级全屏页（捐赠走页内 sub state；诊断复用 HomeContent 的 showDiag 弹层）。
function MineTab({ onOpenDiag }: { onOpenDiag: () => void }) {
  const [sub, setSub] = useState<null | "donate">(null);

  return (
    <>
      <StickyHeader>
        <h1 className="text-lg font-bold text-white">我的</h1>
      </StickyHeader>

      <div className="space-y-3">
        <UpdateCard />

        {/* 列表式入口分组 */}
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          <Row
            label="捐赠"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M19 14c1.5-1.5 3-3.2 3-5.5A3.5 3.5 0 0 0 12 5 3.5 3.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />
              </svg>
            }
            onClick={() => setSub("donate")}
          />
          <div className="h-px bg-white/5" />
          <Row
            label="装机诊断"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
            }
            onClick={onOpenDiag}
          />
        </div>
      </div>

      {/* 捐赠二级页：全屏覆盖，顶部返回条吃安全区 */}
      {sub === "donate" && <DonateView onBack={() => setSub(null)} />}
    </>
  );
}

// 列表行：左图标 + 文案 + 右 chevron，整行可点（≥56px 触控）。
function Row({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-[56px] w-full items-center gap-3 px-4 text-left active:bg-white/5"
    >
      <span className="text-slate-300">{icon}</span>
      <span className="flex-1 text-sm font-medium text-white">{label}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-slate-500">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </button>
  );
}

// 捐赠全屏二级页：固定盖满视口，顶部返回条吃 --safe-top，内部独立滚动放 DonateCard。
function DonateView({ onBack }: { onBack: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-slate-950">
      <div
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-slate-950/85 px-2 backdrop-blur"
        style={{ paddingTop: "calc(var(--safe-top) + 0.5rem)", paddingBottom: "0.5rem" }}
      >
        <button
          onClick={onBack}
          aria-label="返回"
          className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-slate-300 active:bg-white/5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="m15 6-6 6 6 6" />
          </svg>
          返回
        </button>
        <span className="text-sm font-semibold text-white">捐赠</span>
      </div>

      <div
        className="mx-auto w-full max-w-md px-4 pt-3"
        style={{ paddingBottom: "calc(1.5rem + var(--safe-bottom))" }}
      >
        <DonateCard />
      </div>
    </div>
  );
}

// 装机诊断全屏二级页：与 DonateView 同款（顶部「← 返回」条吃 --safe-top，内部独立滚动）。
// 退出统一走返回条，不再用面板内的「✕ 关闭」。DiagPanel 不传 onClose（返回由本壳负责）。
function DiagView({ onBack }: { onBack: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-slate-950">
      <div
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-white/10 bg-slate-950/85 px-2 backdrop-blur"
        style={{ paddingTop: "calc(var(--safe-top) + 0.5rem)", paddingBottom: "0.5rem" }}
      >
        <button
          onClick={onBack}
          aria-label="返回"
          className="flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-slate-300 active:bg-white/5"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="m15 6-6 6 6 6" />
          </svg>
          返回
        </button>
        <span className="text-sm font-semibold text-white">装机诊断</span>
      </div>

      <DiagPanel embedded />
    </div>
  );
}

// 底部固定 Tab 栏：与主容器同宽居中、毛玻璃、安全区内边距。图标用内联 SVG（非 emoji）。
function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const items: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: "home",
      label: "首页",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9 21v-6h6v6" />
        </svg>
      ),
    },
    {
      key: "mine",
      label: "我的",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
        </svg>
      ),
    },
  ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/80 backdrop-blur">
      <div
        className="mx-auto flex w-full max-w-md"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        {items.map((it) => {
          const active = tab === it.key;
          return (
            <button
              key={it.key}
              onClick={() => onChange(it.key)}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                active ? "text-amber-400" : "text-slate-500 active:text-slate-300"
              }`}
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function StatusPill({ status, lastUpdate }: { status: StreamStatus; lastUpdate: number | null }) {
  const map = {
    connecting: { dot: "bg-amber-400", text: "连接中", cls: "text-amber-300" },
    connected: { dot: "bg-emerald-400", text: "实时推送", cls: "text-emerald-300" },
    polling: { dot: "bg-sky-400", text: "轮询中", cls: "text-sky-300" },
  } as const;
  const s = map[status];
  return (
    <div className="flex shrink-0 flex-col items-end">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${s.dot} ${status === "connected" ? "animate-pulse" : ""}`} />
        <span className={`text-xs ${s.cls}`}>{s.text}</span>
      </div>
      {lastUpdate && (
        <span className="text-[11px] tabular-nums text-slate-600">
          {new Date(lastUpdate).toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </span>
      )}
    </div>
  );
}
