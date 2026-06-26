// 极简实时 tick 缓冲（PhoneApp 服务端内存，独立实现，不引用主项目 streamManager）。
//
// 用途：仅为「国际黄金-实时视图」趋势图提供过去 24h 的分时历史。
// 每次 /api/quotes 被调用时，把 xau-usd / xau-cny 的最新价按「真实 UTC 分钟桶」写入；
// 同一分钟覆盖（保留最新价），超出保留期的旧桶自动清理。
//
// 诚实原则：这里【不持久化到磁盘】，也【不预填任何历史】。
// 服务刚启动时缓冲为空，图表是稀疏的，随页面轮询（默认 5s）逐分钟填充——
// 不臆造任何不存在的历史数据点。这一点与主项目（磁盘持久化 tick）的差异已如实告知用户。
//
// globalThis 单例：避免 Next.js dev 模式 HMR 重新求值模块时把已积累的缓冲清零。

import { nowUtcMinute } from "./chartTime";

// 只缓冲国际实时视图需要的两条线
const CAPTURE_IDS = new Set(["xau-usd", "xau-cny"]);

const RETENTION_SECONDS = 25 * 3600; // 略大于 24h，留足边界

type Buffer = Map<string, Map<number, number>>; // instrumentId -> (minuteTs -> price)

const g = globalThis as unknown as { __phoneTickBuffer?: Buffer };
function getBuffer(): Buffer {
  if (!g.__phoneTickBuffer) g.__phoneTickBuffer = new Map();
  return g.__phoneTickBuffer;
}

/** 把一组行情快照按真实 UTC 分钟桶写入缓冲（仅 CAPTURE_IDS）。 */
export function captureTicks(quotes: { instrumentId: string; price: number }[]): void {
  const buffer = getBuffer();
  const minuteTs = nowUtcMinute();
  const cutoff = minuteTs - RETENTION_SECONDS;
  for (const q of quotes) {
    if (!CAPTURE_IDS.has(q.instrumentId)) continue;
    if (!Number.isFinite(q.price) || q.price <= 0) continue;
    let buf = buffer.get(q.instrumentId);
    if (!buf) {
      buf = new Map();
      buffer.set(q.instrumentId, buf);
    }
    buf.set(minuteTs, q.price); // 同分钟覆盖，保留最新
    // 清理旧桶（桶数量较多时才遍历，避免每次全扫）
    if (buf.size > 1600) {
      for (const t of buf.keys()) {
        if (t < cutoff) buf.delete(t);
      }
    }
  }
}

/** 取过去 hours 小时的分时点（真实 UTC 秒级时间戳，升序）。 */
export function getTickHistory(
  hours: number,
): Record<string, { time: number; value: number }[]> {
  const buffer = getBuffer();
  const cutoff = nowUtcMinute() - hours * 3600;
  const result: Record<string, { time: number; value: number }[]> = {};
  for (const [id, buf] of buffer) {
    const pts: { time: number; value: number }[] = [];
    for (const [t, v] of buf) {
      if (t >= cutoff) pts.push({ time: t, value: v });
    }
    pts.sort((a, b) => a.time - b.time);
    if (pts.length > 0) result[id] = pts;
  }
  return result;
}
