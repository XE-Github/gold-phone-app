"use client";

// 价格提醒（纯客户端）。规则存 localStorage，触发=toast + 可选系统通知 + 提示音。
// 同规则满足后只触发一次，价格离开阈值才复位（避免反复响）。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  registerNotificationSW,
  requestNotificationPermission as requestPerm,
  showSystemNotification,
} from "./notify";
import { metaFor } from "./display";
import { useAppForeground } from "./useAppForeground";

const STORAGE_KEY = "gold-phone-price-alerts-v1";
// 今日触发计数（与规则存储解耦）。带 day 标记，跨自然日丢弃归零。
const COUNT_KEY = "gold-phone-alert-counts-v1";

export type AlertDirection = "above" | "below";

export type AlertRule = {
  id: string;
  instrumentId: string; // 监控哪个标的（默认 xau-cny 人民币理论金价）
  direction: AlertDirection;
  threshold: number;
  enabled: boolean;
  sound: boolean;
};

export type FiredAlert = {
  rule: AlertRule;
  price: number;
  at: number;
};

function loadRules(): AlertRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AlertRule[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r) =>
        r &&
        typeof r.id === "string" &&
        typeof r.threshold === "number" &&
        (r.direction === "above" || r.direction === "below"),
    );
  } catch {
    return [];
  }
}

// 本地自然日（设备时区），en-CA 输出 YYYY-MM-DD，便于字符串比对。
function todayKey(): string {
  return new Date().toLocaleDateString("en-CA");
}

type AlertCounts = { day: string; byRule: Record<string, number> };

// 读取今日触发计数：day 不是今天则丢弃归零（跨天重置）。
function loadCounts(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COUNT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as AlertCounts;
    if (!parsed || typeof parsed !== "object" || parsed.day !== todayKey()) return {};
    return parsed.byRule && typeof parsed.byRule === "object" ? parsed.byRule : {};
  } catch {
    return {};
  }
}

function persistCounts(byRule: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const payload: AlertCounts = { day: todayKey(), byRule };
    window.localStorage.setItem(COUNT_KEY, JSON.stringify(payload));
  } catch {
    /* 忽略存储失败 */
  }
}

// 简单提示音（Web Audio，无需音频文件）。浏览器要求用户先交互才能出声。
function playBeep() {
  try {
    const AudioCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
    osc.onended = () => ctx.close();
  } catch {
    /* 忽略音频失败 */
  }
}

export function usePriceAlerts(priceById: Map<string, number>) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [fired, setFired] = useState<FiredAlert | null>(null);
  // 今日各规则触发次数（按价格穿越阈值累计，跨自然日归零）
  const [counts, setCounts] = useState<Record<string, number>>({});
  // 记录每条规则当前是否处于"已触发"锁定态（价格离开阈值才解锁）
  const lockedRef = useRef<Record<string, boolean>>({});

  // 最新价 live ref：让 evaluateNow / 回前台补检查能读到当前价，而不必把 priceById 塞进
  // evaluateNow 的依赖（否则每次价格变动都重建回调、useAppForeground 反复重绑）。同 back-button 手法。
  const priceByIdRef = useRef(priceById);
  useEffect(() => {
    priceByIdRef.current = priceById;
  });

  // evaluateNow 的 live ref：useAppForeground 的 onResume 需在 evaluateNow 定义【之前】拿到
  // foregroundRef，故用 ref 转发（回前台时调最新 evaluateNow）。同 useAndroidBackButton 的 decideRef。
  const evaluateNowRef = useRef<(justResumed: boolean) => void>(() => {});

  // 前台状态 + 回前台补检查（问题 2/4/5）。先于 evaluateNow 声明，供其读 foregroundRef.current
  // 做系统通知门（读 .current，不入依赖）。onResume 经 evaluateNowRef 转发到最新闭包。
  const { foregroundRef } = useAppForeground(() => evaluateNowRef.current(true));

  // 首次从 localStorage 读取（避免 hydration 不一致）。
  // queueMicrotask 把 setState 推迟出 effect 同步体，满足 react-hooks/set-state-in-effect。
  useEffect(() => {
    queueMicrotask(() => {
      setRules(loadRules());
      setCounts(loadCounts()); // 含跨天重置：非今天的旧计数被丢弃
      setHydrated(true);
    });
    // 提前注册通知 Service Worker（手机弹窗依赖它；已授权才真正发通知）
    void registerNotificationSW();
  }, []);

  // 持久化
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    } catch {
      /* 忽略存储失败 */
    }
  }, [rules, hydrated]);

  // 规则评估（单一事实源）。价格变化时调，回前台时也调（justResumed=true）。
  // 读价走 priceByIdRef（最新值），故依赖只 [rules, hydrated]，不含 priceById——避免每次
  // 价格变动重建回调 → useAppForeground 反复重绑（同 useAndroidBackButton 的 ref-defer 手法）。
  //
  // justResumed：从后台回到前台那一刻的补检查。安卓后台会挂起整个进程（Node 定时器 + WebView JS
  // 全冻结），冻结期间根本不评估规则；回前台用最新价复评一次，把冻结期间发生、且【此刻仍成立】
  // 的穿越补弹系统通知出来。⚠️ 诚实边界：冻结期间瞬穿又回落的价格无法补（那段时间没采数），
  // 这是无常驻后台服务方案的根本上限，不在 UI 谎称"后台实时"。
  const evaluateNow = useCallback(
    (justResumed: boolean) => {
      if (!hydrated) return;
      const prices = priceByIdRef.current;
      for (const rule of rules) {
        if (!rule.enabled) {
          lockedRef.current[rule.id] = false;
          continue;
        }
        const price = prices.get(rule.instrumentId);
        if (price === undefined || !Number.isFinite(price) || price <= 0) continue;

        const meets =
          rule.direction === "above" ? price >= rule.threshold : price <= rule.threshold;

        if (meets && !lockedRef.current[rule.id]) {
          lockedRef.current[rule.id] = true; // 锁定，避免重复触发
          setFired({ rule, price, at: Date.now() });
          // 今日触发次数 +1（按穿越累计，落盘并带当天 day）
          setCounts((prev) => {
            const next = { ...prev, [rule.id]: (prev[rule.id] ?? 0) + 1 };
            persistCounts(next);
            return next;
          });
          // 问题 2：前台不弹系统通知（应用内 AlertToast 已够，弹系统通知是重复打扰）；
          //         仅后台/关闭时，或回前台补检查(justResumed)时才弹系统通知。
          if (!foregroundRef.current || justResumed) {
            // 问题 1：标题带具体标的+方向+阈值（例：人民币理论金价 跌破 875.00），不再笼统"黄金价格提醒"。
            const label =
              metaFor(rule.instrumentId)?.shortName ??
              metaFor(rule.instrumentId)?.name ??
              rule.instrumentId;
            const dirWord = rule.direction === "above" ? "突破" : "跌破";
            const unit = metaFor(rule.instrumentId)?.unit ?? "";
            const title = `${label} ${dirWord} ${rule.threshold.toFixed(2)}`;
            const body = `当前 ${price.toFixed(2)} ${unit}`.trim();
            void showSystemNotification(title, body);
          }
          playBeep(); // 一律出声（前台也响，作为应用内到价的即时反馈）
        } else if (!meets && lockedRef.current[rule.id]) {
          lockedRef.current[rule.id] = false; // 离开阈值，复位
        }
      }
    },
    // foregroundRef 是 useAppForeground 返回的稳定 ref（跨 render 不变），列入仅为满足
    // exhaustive-deps，不会导致回调重建。
    [rules, hydrated, foregroundRef],
  );

  // evaluateNowRef 每次 render 刷新为最新 evaluateNow（供 onResume 转发调用）。
  useEffect(() => {
    evaluateNowRef.current = evaluateNow;
  });

  // 价格变化时评估（前台常态路径）。evaluateNow 稳定（依赖 [rules,hydrated]），
  // priceById 变动即触发本 effect。queueMicrotask 推迟出同步体，满足 set-state-in-effect。
  useEffect(() => {
    if (!hydrated) return;
    queueMicrotask(() => evaluateNow(false));
  }, [priceById, evaluateNow, hydrated]);

  const addRule = useCallback((rule: Omit<AlertRule, "id">) => {
    const id = `${rule.instrumentId}-${rule.direction}-${rule.threshold}-${Date.now()}`;
    setRules((prev) => [...prev, { ...rule, id }]);
  }, []);

  const removeRule = useCallback((id: string) => {
    delete lockedRef.current[id];
    setRules((prev) => prev.filter((r) => r.id !== id));
    // 同步清掉该规则的今日计数，避免 localStorage 泄漏
    setCounts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      persistCounts(next);
      return next;
    });
  }, []);

  const toggleRule = useCallback((id: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)),
    );
  }, []);

  const dismissFired = useCallback(() => setFired(null), []);

  const requestNotificationPermission = useCallback(async () => {
    return requestPerm();
  }, []);

  return {
    rules,
    hydrated,
    fired,
    counts,
    addRule,
    removeRule,
    toggleRule,
    dismissFired,
    requestNotificationPermission,
  };
}
