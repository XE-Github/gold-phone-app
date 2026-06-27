"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Quote } from "@/lib/types";
import { HeroPrice } from "@/components/HeroPrice";
import { TrendChart } from "@/components/TrendChart";
import { PriceAlertCard } from "@/components/PriceAlertCard";
import { AlertToast } from "@/components/AlertToast";
import { BankGoldCompare } from "@/components/BankGoldCompare";
import { UpdateCard } from "@/components/UpdateCard";
import { usePriceAlerts } from "@/lib/usePriceAlerts";
import { subscribeQuotes, type StreamStatus } from "@/lib/quotesStream";
import { BANK_GOLD_PRODUCTS } from "@/lib/bankProducts";

// 积存金标的 id 集合：SSE 把行情+积存金合并推送，前端按 id 归属拆回两份。
const BANK_IDS = new Set(BANK_GOLD_PRODUCTS.map((p) => p.instrumentId));

function toMap(quotes: Quote[]): Map<string, Quote> {
  const m = new Map<string, Quote>();
  for (const q of quotes) m.set(q.instrumentId, q);
  return m;
}

export default function Home() {
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [bankQuotes, setBankQuotes] = useState<Map<string, Quote>>(new Map());
  const [bankMeta, setBankMeta] = useState<{ realCount: number; total: number }>({
    realCount: 0,
    total: 0,
  });
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
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
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-16 pt-4">
      <AlertToast fired={alerts.fired} onDismiss={alerts.dismissFired} />

      {/* Header：与卡片左右对齐（统一 px-4 容器，header 不再额外缩进） */}
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-white">黄金看板·手机版</h1>
          <p className="text-[11px] text-slate-500">实时金价 · 提醒 · 积存金对比</p>
        </div>
        <StatusPill status={status} lastUpdate={lastUpdate} />
      </header>

      {warnings.length > 0 && (
        <div className="mb-3 space-y-0.5 rounded-xl border border-amber-400/20 bg-amber-500/[0.07] p-3 text-[11px] leading-relaxed text-amber-200/80">
          {warnings.map((w, i) => (
            <p key={i}>· {w}</p>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <HeroPrice quotes={quotes} serverTime={lastUpdate} />
        <TrendChart quotes={quotes} />
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
        <UpdateCard />
      </div>

      <footer className="mt-6 text-center text-[11px] leading-relaxed text-slate-600">
        <p>学习辅助工具，非投资建议，投资有风险。</p>
        <div className="mt-2 flex items-center justify-center gap-2">
          <a
            href="/diag"
            className="inline-flex min-h-9 items-center rounded-lg border border-white/5 px-3 text-slate-400"
          >
            装机诊断
          </a>
          <a
            href="/notify-check"
            className="inline-flex min-h-9 items-center rounded-lg border border-white/5 px-3 text-slate-400"
          >
            通知诊断
          </a>
        </div>
      </footer>
    </main>
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
