// 实时行情推送管理器（PhoneApp 独立实现，不引用主项目）。
//
// 链路对齐主程序：后端每 2s 抓一次行情（getQuotes：新浪+Gold-API+计算），
// 抓到就 broadcast 给所有 SSE 订阅者（/api/stream）。前端 EventSource 收到即更新。
//
// 单例：用 globalThis 持有状态，避免 Next dev HMR 重新求值模块时重复起定时器。
// 引用计数：有订阅者才跑定时器，最后一个断开后延时停掉（省资源）。
//
// 诚实：数据时效完全由上游决定（新浪伦敦金实测约每分钟更新一次），
// 2s 抓取 + 即时推送只是“源头一变就尽快显示”，不会让数据比上游更新更快。

import type { Quote, QuotesPayload } from "./types";
import { getQuotes } from "./quotes";

const FAST_MS = 2000; // 抓取间隔，对齐主程序
const STOP_DELAY_MS = 30_000; // 无订阅者后延时停定时器

type Subscriber = (payload: QuotesPayload) => void;

interface StreamState {
  subscribers: Set<Subscriber>;
  quotes: Quote[];
  warnings: string[];
  serverTime: number;
  timer: ReturnType<typeof setInterval> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  refreshing: boolean;
}

const g = globalThis as unknown as { __phoneStream?: StreamState };

function getState(): StreamState {
  if (!g.__phoneStream) {
    g.__phoneStream = {
      subscribers: new Set(),
      quotes: [],
      warnings: [],
      serverTime: 0,
      timer: null,
      stopTimer: null,
      refreshing: false,
    };
  }
  return g.__phoneStream;
}

function broadcast(state: StreamState) {
  const payload: QuotesPayload = {
    quotes: state.quotes,
    warnings: state.warnings,
    serverTime: state.serverTime,
  };
  for (const sub of state.subscribers) {
    try {
      sub(payload);
    } catch {
      // 单个订阅者异常不影响其他
    }
  }
}

async function refresh(state: StreamState) {
  if (state.refreshing) return; // 上一轮还没回来就跳过，避免堆叠
  state.refreshing = true;
  try {
    const { quotes, warnings } = await getQuotes();
    state.quotes = quotes;
    state.warnings = warnings;
    state.serverTime = Date.now();
    broadcast(state);
  } catch {
    // 抓取失败保留上一份数据，不推空
  } finally {
    state.refreshing = false;
  }
}

function startTimer(state: StreamState) {
  if (state.stopTimer) {
    clearTimeout(state.stopTimer);
    state.stopTimer = null;
  }
  if (state.timer) return;
  void refresh(state); // 立即抓一次
  state.timer = setInterval(() => void refresh(state), FAST_MS);
}

function maybeStopTimer(state: StreamState) {
  if (state.subscribers.size > 0) return;
  if (state.stopTimer) return;
  // 延时停：短时间内若有新连接进来可复用，避免频繁起停
  state.stopTimer = setTimeout(() => {
    if (state.subscribers.size === 0 && state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    state.stopTimer = null;
  }, STOP_DELAY_MS);
}

/** 订阅行情推送。连接时若已有快照立即推一次。返回取消订阅函数。 */
export function subscribe(sub: Subscriber): () => void {
  const state = getState();
  state.subscribers.add(sub);
  startTimer(state);

  // 已有快照则立即推一次（新连接不必等下一个 2s 周期）
  if (state.serverTime > 0) {
    try {
      sub({ quotes: state.quotes, warnings: state.warnings, serverTime: state.serverTime });
    } catch {
      /* ignore */
    }
  }

  return () => {
    state.subscribers.delete(sub);
    maybeStopTimer(state);
  };
}
