"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Quote, BankGoldPayload } from "@/lib/types";
import { HeroPrice } from "@/components/HeroPrice";
import { TrendChart } from "@/components/TrendChart";
import { PriceAlertCard } from "@/components/PriceAlertCard";
import { AlertToast } from "@/components/AlertToast";
import { BankGoldCompare } from "@/components/BankGoldCompare";
import { usePriceAlerts } from "@/lib/usePriceAlerts";
import { subscribeQuotes, type StreamStatus } from "@/lib/quotesStream";

const BANK_INTERVAL = 15000; // 积存金 15s 轮询（慢数据，不走 SSE）

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

  const loadBank = useCallback(async () => {
    try {
      const res = await fetch("/api/bank-gold", { cache: "no-store" });
      const data = (await res.json()) as BankGoldPayload;
      if (!mounted.current) return;
      setBankQuotes(toMap(data.quotes));
      setBankMeta({ realCount: data.realCount, total: data.total });
    } catch {
      /* 保留旧数据 */
    }
  }, []);

  useEffect(() => {
    mounted.current = true;

    // 行情：SSE 推送（后端 2s 抓一次，抓到即推；断线自动降级 5s 轮询）。
    // queueMicrotask：把订阅/首帧抓取推迟出 effect 同步体，满足 react-hooks/set-state-in-effect。
    let unsubscribe: (() => void) | null = null;
    queueMicrotask(() => {
      unsubscribe = subscribeQuotes(
        (data) => {
          if (!mounted.current) return;
          setQuotes(toMap(data.quotes));
          setWarnings(data.warnings ?? []);
          setLastUpdate(data.serverTime);
        },
        (s) => {
          if (mounted.current) setStatus(s);
        },
      );
      void loadBank();
    });

    // 积存金：慢数据，独立 15s 轮询（不走 SSE）。
    const b = window.setInterval(loadBank, BANK_INTERVAL);

    return () => {
      mounted.current = false;
      unsubscribe?.();
      window.clearInterval(b);
    };
  }, [loadBank]);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-3 pb-16 pt-3">
      <AlertToast fired={alerts.fired} onDismiss={alerts.dismissFired} />

      {/* Header */}
      <header className="mb-3 flex items-center justify-between px-1">
        <div>
          <h1 className="text-lg font-bold text-white">黄金看板·手机版</h1>
          <p className="text-[11px] text-slate-500">实时金价 · 提醒 · 积存金对比</p>
        </div>
        <StatusPill status={status} lastUpdate={lastUpdate} />
      </header>

      {warnings.length > 0 && (
        <div className="mb-3 rounded-2xl border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2 text-[11px] text-amber-200/80">
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
      </div>
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
    <div className="flex flex-col items-end">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${s.dot} ${status === "connected" ? "animate-pulse" : ""}`} />
        <span className={`text-xs ${s.cls}`}>{s.text}</span>
      </div>
      {lastUpdate && (
        <span className="text-[10px] tabular-nums text-slate-600">
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
