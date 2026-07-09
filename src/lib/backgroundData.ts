"use client";

import { isNativeApp } from "./apiBase";
import type { QuotesPayload } from "./types";

type BackgroundDataStatus = {
  running?: boolean;
  lastSuccess?: number;
  lastError?: string;
  snapshot?: QuotesPayload;
};

type BackgroundDataPlugin = {
  start?: () => Promise<BackgroundDataStatus>;
  stop?: () => Promise<BackgroundDataStatus>;
  status?: () => Promise<BackgroundDataStatus>;
  syncRules?: (opts: { rules: string }) => Promise<BackgroundDataStatus>;
};

function getPlugin(): BackgroundDataPlugin | null {
  try {
    if (typeof window === "undefined") return null;
    const cap = (window as unknown as { Capacitor?: { Plugins?: { BackgroundData?: BackgroundDataPlugin } } }).Capacitor;
    return cap?.Plugins?.BackgroundData ?? null;
  } catch {
    return null;
  }
}

export function backgroundDataSupported(): boolean {
  return isNativeApp() && getPlugin() !== null;
}

export async function getBackgroundDataStatus(): Promise<BackgroundDataStatus> {
  const plugin = getPlugin();
  if (!plugin?.status) return { running: false };
  return plugin.status();
}

export async function backgroundDataStatus(): Promise<boolean> {
  const result = await getBackgroundDataStatus();
  return result.running === true;
}

export async function startBackgroundData(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin?.start) return false;
  const result = await plugin.start();
  return result.running === true;
}

export async function stopBackgroundData(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin?.stop) return false;
  const result = await plugin.stop();
  return result.running === true;
}

export async function syncBackgroundAlertRules(rules: unknown[]): Promise<void> {
  const plugin = getPlugin();
  if (!plugin?.syncRules) return;
  await plugin.syncRules({ rules: JSON.stringify(rules) });
}

export async function latestBackgroundSnapshot(): Promise<QuotesPayload | null> {
  const status = await getBackgroundDataStatus();
  return status.snapshot && Array.isArray(status.snapshot.quotes) ? status.snapshot : null;
}
