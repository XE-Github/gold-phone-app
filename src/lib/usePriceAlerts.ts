"use client";

// 价格提醒（纯客户端）。规则存 localStorage，触发=toast + 可选系统通知 + 提示音。
// 同规则满足后只触发一次，价格离开阈值才复位（避免反复响）。

import { useCallback, useEffect, useRef, useState } from "react";
import {
  registerNotificationSW,
  requestNotificationPermission as requestPerm,
  showSystemNotification,
} from "./notify";

const STORAGE_KEY = "gold-phone-price-alerts-v1";

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
  // 记录每条规则当前是否处于"已触发"锁定态（价格离开阈值才解锁）
  const lockedRef = useRef<Record<string, boolean>>({});

  // 首次从 localStorage 读取（避免 hydration 不一致）。
  // queueMicrotask 把 setState 推迟出 effect 同步体，满足 react-hooks/set-state-in-effect。
  useEffect(() => {
    queueMicrotask(() => {
      setRules(loadRules());
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

  // 价格变化时评估规则
  useEffect(() => {
    if (!hydrated) return;
    for (const rule of rules) {
      if (!rule.enabled) {
        lockedRef.current[rule.id] = false;
        continue;
      }
      const price = priceById.get(rule.instrumentId);
      if (price === undefined || !Number.isFinite(price) || price <= 0) continue;

      const meets =
        rule.direction === "above" ? price >= rule.threshold : price <= rule.threshold;

      if (meets && !lockedRef.current[rule.id]) {
        lockedRef.current[rule.id] = true; // 锁定，避免重复触发
        const dir = rule.direction === "above" ? "突破上限" : "跌破下限";
        setFired({ rule, price, at: Date.now() });
        void showSystemNotification(
          "黄金价格提醒",
          `价格 ${price.toFixed(2)} ${dir} ${rule.threshold.toFixed(2)}`,
        );
        if (rule.sound) playBeep();
      } else if (!meets && lockedRef.current[rule.id]) {
        lockedRef.current[rule.id] = false; // 离开阈值，复位
      }
    }
  }, [priceById, rules, hydrated]);

  const addRule = useCallback((rule: Omit<AlertRule, "id">) => {
    const id = `${rule.instrumentId}-${rule.direction}-${rule.threshold}-${Date.now()}`;
    setRules((prev) => [...prev, { ...rule, id }]);
  }, []);

  const removeRule = useCallback((id: string) => {
    delete lockedRef.current[id];
    setRules((prev) => prev.filter((r) => r.id !== id));
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
    addRule,
    removeRule,
    toggleRule,
    dismissFired,
    requestNotificationPermission,
  };
}
