"use client";

// 行情订阅（PhoneApp 客户端，独立实现）。
// 优先 SSE(/api/stream) 推送；连接失败自动降级为 5s 轮询（/api/quotes + /api/bank-gold），
// 并定时尝试重连 SSE。链路对齐主程序 subscribeToQuotes。

import type { Quote, QuotesPayload } from "./types";

export type StreamStatus = "connecting" | "connected" | "polling";

const POLL_MS = 5000; // 降级轮询间隔（SSE 不可用时）

export function subscribeQuotes(
  onUpdate: (payload: QuotesPayload) => void,
  onStatus?: (status: StreamStatus) => void,
): () => void {
  let disposed = false;
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const startPolling = () => {
    if (disposed || pollTimer) return;
    onStatus?.("polling");
    // 降级态：SSE 不可用时，行情(/api/quotes)与积存金(/api/bank-gold)分两条端点并行抓，
    // 合并成同一 QuotesPayload（含 bank meta）再回调，与 SSE 推送的数据形态一致。
    const poll = async () => {
      if (disposed) return;
      try {
        const [quotesRes, bankRes] = await Promise.allSettled([
          fetch("/api/quotes", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/bank-gold", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (disposed) return;
        if (quotesRes.status !== "fulfilled") return; // 行情都拿不到就跳过本轮

        const base = quotesRes.value as QuotesPayload;
        const merged: QuotesPayload = { ...base };
        if (bankRes.status === "fulfilled") {
          const bank = bankRes.value as {
            quotes?: Quote[];
            realCount?: number;
            total?: number;
          };
          merged.quotes = [...base.quotes, ...(bank.quotes ?? [])];
          merged.bankRealCount = bank.realCount ?? 0;
          merged.bankTotal = bank.total ?? bank.quotes?.length ?? 0;
        }
        onUpdate(merged);
      } catch {
        /* 下次重试 */
      }
    };
    void poll();
    pollTimer = setInterval(() => void poll(), POLL_MS);
  };

  const stopPolling = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startSSE = () => {
    if (disposed) return;
    onStatus?.("connecting");
    try {
      es = new EventSource("/api/stream");
    } catch {
      startPolling();
      return;
    }

    es.onopen = () => {
      if (disposed) return;
      onStatus?.("connected");
      stopPolling(); // SSE 连上，停掉降级轮询
    };

    es.onmessage = (event) => {
      if (disposed) return;
      try {
        const payload = JSON.parse(event.data) as QuotesPayload;
        onUpdate(payload);
      } catch {
        /* 忽略解析失败（如心跳） */
      }
    };

    es.onerror = () => {
      if (disposed) return;
      es?.close();
      es = null;
      startPolling(); // 立即降级轮询，保证不断流
      // 5s 后尝试重连 SSE
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (!disposed && !es) startSSE();
      }, 5000);
    };
  };

  startSSE();

  return () => {
    disposed = true;
    es?.close();
    es = null;
    stopPolling();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}
