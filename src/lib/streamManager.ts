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
import { fetchBankGoldQuotes } from "./bankGold";

const FAST_MS = 2000; // 行情抓取间隔，对齐主程序快循环
const BANK_MS = 3000; // 积存金抓取间隔，对齐主程序积存金循环（独立于行情，互不阻塞）
const STOP_DELAY_MS = 30_000; // 无订阅者后延时停定时器

type Subscriber = (payload: QuotesPayload) => void;

interface StreamState {
  subscribers: Set<Subscriber>;
  quotes: Quote[];
  warnings: string[];
  serverTime: number;
  bankQuotes: Quote[]; // 积存金 quotes，独立 3s 循环抓取
  bankRealCount: number; // 积存金真实数据条数
  timer: ReturnType<typeof setInterval> | null;
  bankTimer: ReturnType<typeof setInterval> | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  refreshing: boolean;
  bankRefreshing: boolean;
}

const g = globalThis as unknown as { __phoneStream?: StreamState };

function getState(): StreamState {
  if (!g.__phoneStream) {
    g.__phoneStream = {
      subscribers: new Set(),
      quotes: [],
      warnings: [],
      serverTime: 0,
      bankQuotes: [],
      bankRealCount: 0,
      timer: null,
      bankTimer: null,
      stopTimer: null,
      refreshing: false,
      bankRefreshing: false,
    };
  }
  return g.__phoneStream;
}

// 把当前快照（行情 + 积存金合并）推给所有订阅者。
// 行情与积存金共用同一条流（对齐主程序），前端按 instrumentId 归属拆分。
function snapshot(state: StreamState): QuotesPayload {
  return {
    quotes: [...state.quotes, ...state.bankQuotes],
    warnings: state.warnings,
    serverTime: state.serverTime,
    bankRealCount: state.bankRealCount,
    bankTotal: state.bankQuotes.length,
  };
}

function broadcast(state: StreamState) {
  const payload = snapshot(state);
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

// 积存金独立循环：从已抓到的行情里取 SGE Au99.99 / 人民币理论价作兜底基准，
// 调 fetchBankGoldQuotes 抓各行报价，写入后并入广播。
// 独立于行情快循环，互不阻塞（积存金多家并发、单家 8s 超时，比行情慢）。
async function refreshBank(state: StreamState) {
  if (state.bankRefreshing) return; // 上一轮还没回来就跳过，避免堆叠
  state.bankRefreshing = true;
  try {
    const sgeAu = state.quotes.find((q) => q.instrumentId === "sge-au9999")?.price;
    const xauCny = state.quotes.find((q) => q.instrumentId === "xau-cny")?.price;
    const { quotes, realCount } = await fetchBankGoldQuotes(sgeAu, xauCny);
    state.bankQuotes = quotes;
    state.bankRealCount = realCount;
    state.serverTime = Date.now();
    broadcast(state);
  } catch {
    // 抓取失败保留上一份积存金数据，不推空
  } finally {
    state.bankRefreshing = false;
  }
}

function startTimer(state: StreamState) {
  if (state.stopTimer) {
    clearTimeout(state.stopTimer);
    state.stopTimer = null;
  }
  if (state.timer) return;
  void refresh(state); // 行情：立即抓一次
  state.timer = setInterval(() => void refresh(state), FAST_MS);
  void refreshBank(state); // 积存金：立即抓一次
  state.bankTimer = setInterval(() => void refreshBank(state), BANK_MS);
}

function maybeStopTimer(state: StreamState) {
  if (state.subscribers.size > 0) return;
  if (state.stopTimer) return;
  // 延时停：短时间内若有新连接进来可复用，避免频繁起停
  state.stopTimer = setTimeout(() => {
    if (state.subscribers.size === 0) {
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
      if (state.bankTimer) {
        clearInterval(state.bankTimer);
        state.bankTimer = null;
      }
    }
    state.stopTimer = null;
  }, STOP_DELAY_MS);
}

/** 订阅行情推送。连接时若已有快照立即推一次。返回取消订阅函数。 */
export function subscribe(sub: Subscriber): () => void {
  const state = getState();
  state.subscribers.add(sub);
  startTimer(state);

  // 已有快照则立即推一次（行情+积存金合并，新连接不必等下一个周期）
  if (state.serverTime > 0) {
    try {
      sub(snapshot(state));
    } catch {
      /* ignore */
    }
  }

  return () => {
    state.subscribers.delete(sub);
    maybeStopTimer(state);
  };
}
