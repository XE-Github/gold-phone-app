// 趋势图时间工具（PhoneApp 独立实现，不引用主项目）。
// 国际视图用「真实 UTC 秒级时间戳」：tick 按真实 UTC 分钟落桶，
// lightweight-charts 默认按 UTC 显示 → 图表轴即为国际时间。

/** 当前 UTC 时间的分钟桶（秒级真实 UTC 时间戳） */
export function nowUtcMinute(): number {
  const now = new Date();
  return Math.floor(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
    ) / 1000,
  );
}
