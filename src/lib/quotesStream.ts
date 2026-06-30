"use client";

// 行情订阅（PhoneApp 客户端，独立实现）。
//
// 经统一传输层（apiBase）取数，对三态透明：
//   - 原生 App：IPC 推流（subscribeStream 内部走 NodeJS channel）
//   - 浏览器/dev、局域网/Termux 兑底：HTTP SSE（subscribeStream 内部走 EventSource）
// 推流不可用（onStatus 报 "polling" 或订阅异常）时，自动降级为 5s 轮询
// （requestRoute /api/quotes + /api/bank-gold，同样三态透明），并定时尝试恢复推流。

import type { Quote, QuotesPayload } from "./types";
import { requestRoute, subscribeStream, type StreamStatus } from "./apiBase";
import { isMockMode, mockPayload } from "./mockData";

export type { StreamStatus };

const POLL_MS = 5000; // 降级轮询间隔（推流不可用时）
const RETRY_MS = 5000; // 推流断开后多久尝试重连

export function subscribeQuotes(
  onUpdate: (payload: QuotesPayload) => void,
  onStatus?: (status: StreamStatus) => void,
): () => void {
  // ⚠️ MOCK 短路：仅浏览器 ?mock=1 预览排版用，直接喂假数据、不碰任何网络。
  //    生产/真机不带此参数，下面整段不会执行，行为与从前完全一致。
  if (isMockMode()) {
    onStatus?.("connected");
    queueMicrotask(() => onUpdate(mockPayload()));
    return () => {};
  }

  let disposed = false;
  let unsubscribeStream: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const startPolling = () => {
    if (disposed || pollTimer) return;
    onStatus?.("polling");
    // 降级态：行情(/api/quotes)与积存金(/api/bank-gold)并行取，合并成同一 QuotesPayload
    // （含 bank meta）再回调，与推流的数据形态一致。
    const poll = async () => {
      if (disposed) return;
      try {
        const [quotesRes, bankRes] = await Promise.allSettled([
          requestRoute("/api/quotes"),
          requestRoute("/api/bank-gold"),
        ]);
        if (disposed) return;
        if (quotesRes.status !== "fulfilled") return; // 行情都拿不到就跳过本轮

        const base = quotesRes.value;
        const merged: QuotesPayload = { ...base };
        if (bankRes.status === "fulfilled") {
          const bank = bankRes.value;
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

  const startStream = () => {
    if (disposed) return;
    unsubscribeStream = subscribeStream(
      (payload) => {
        if (disposed) return;
        stopPolling(); // 推流有数据进来，停掉降级轮询
        onUpdate(payload);
      },
      (status) => {
        if (disposed) return;
        if (status === "connected") {
          stopPolling();
          onStatus?.("connected");
        } else if (status === "polling") {
          // 推流报错/断开：立即降级轮询保证不断流，稍后尝试恢复推流
          onStatus?.("polling");
          startPolling();
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            if (disposed) return;
            unsubscribeStream?.();
            unsubscribeStream = null;
            startStream();
          }, RETRY_MS);
        } else {
          onStatus?.(status); // connecting
        }
      },
    );
  };

  startStream();

  return () => {
    disposed = true;
    unsubscribeStream?.();
    unsubscribeStream = null;
    stopPolling();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
}

// 兼容旧引用：若其它处直接 import 了 Quote 类型，从这里再导出一次。
export type { Quote };
