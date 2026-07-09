"use client";

import { isNativeApp } from "./apiBase";

type BackgroundDataPlugin = {
  start?: () => Promise<{ running?: boolean }>;
  stop?: () => Promise<{ running?: boolean }>;
  status?: () => Promise<{ running?: boolean }>;
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

export async function backgroundDataStatus(): Promise<boolean> {
  const plugin = getPlugin();
  if (!plugin?.status) return false;
  const result = await plugin.status();
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
