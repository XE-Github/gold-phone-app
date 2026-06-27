"use client";

// 应用内 OTA 升级（连 GitHub Releases）。
//
// 流程：checkForUpdate() 拉 GitHub latest release → 比对版本（package.json version，经
// next.config 注入 NEXT_PUBLIC_APP_VERSION）→ 有新版则 downloadAndInstall() 用
// @capacitor/filesystem 下载 apk 到 Cache，再调自定义原生插件 ApkInstaller.installApk()
// （FileProvider + ACTION_VIEW Intent）唤起【系统安装器】。
//
// 诚实边界：
//   - 升级非完全静默：Android 安全机制要求用户在系统安装弹窗点「安装」，本 OTA 只能把人送到那一步。
//   - 仅原生壳可安装；浏览器/dev 环境 canInstall=false，只能跳转 Release 页让用户手动下载。
//   - 比对基于语义版本号字符串；预发布/构建元数据不做精细处理（够用即可）。
//
// 不静态 import 插件（与 apiBase/notify 同套路）：web/dev 无插件时静态 import 会运行期炸。

import { isNativeApp } from "./apiBase";

const REPO = "XE-Github/gold-phone-app";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASE_PAGE_URL = `https://github.com/${REPO}/releases/latest`;

/** 当前 App 版本（package.json version → next.config env 注入）。 */
export function currentVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
}

export interface UpdateInfo {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string | null; // 解析失败为 null
  downloadUrl: string | null; // apk 资产直链；无 apk 资产则 null
  releaseNotes: string;
  releasePageUrl: string; // 兜底：让用户手动下载
  /** 当前环境是否支持「下载并唤起安装」（原生壳 + 插件在场）。 */
  canInstall: boolean;
  /** 拉取/解析失败时的说明（成功为空串）。 */
  error: string;
}

// ── 语义版本比对 ────────────────────────────────────────────────────────────────

/** 归一版本串：去掉前缀 v、按 . 拆数字，缺位补 0。忽略 -beta 等预发布尾巴。 */
function parseVer(v: string): number[] {
  const core = v.replace(/^v/i, "").split(/[-+]/)[0]; // 去 v 前缀 + 预发布/构建元数据
  return core.split(".").map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** a 是否比 b 新（语义版本）。 */
export function isNewer(a: string, b: string): boolean {
  const pa = parseVer(a);
  const pb = parseVer(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return true;
    if (da < db) return false;
  }
  return false; // 相等不算更新
}

// ── 自定义原生安装插件运行期探测 ────────────────────────────────────────────────

interface ApkInstallerPlugin {
  // 输入文件的本地路径（file:// 或绝对路径）；原生侧转 FileProvider content URI 并唤起安装器。
  installApk: (opts: { filePath: string }) => Promise<{ launched: boolean }>;
}

function getApkInstaller(): ApkInstallerPlugin | null {
  try {
    if (typeof window === "undefined") return null;
    const cap = (window as unknown as {
      Capacitor?: { Plugins?: { ApkInstaller?: ApkInstallerPlugin } };
    }).Capacitor;
    return cap?.Plugins?.ApkInstaller ?? null;
  } catch {
    return null;
  }
}

interface FilesystemPlugin {
  downloadFile: (opts: {
    url: string;
    path: string;
    directory: string;
    progress?: boolean;
  }) => Promise<{ path?: string }>;
  getUri: (opts: { path: string; directory: string }) => Promise<{ uri: string }>;
  addListener?: (
    eventName: string,
    cb: (e: { url?: string; bytes?: number; contentLength?: number }) => void,
  ) => Promise<{ remove: () => void }> | { remove: () => void };
}

function getFilesystem(): FilesystemPlugin | null {
  try {
    if (typeof window === "undefined") return null;
    const cap = (window as unknown as {
      Capacitor?: { Plugins?: { Filesystem?: FilesystemPlugin } };
    }).Capacitor;
    return cap?.Plugins?.Filesystem ?? null;
  } catch {
    return null;
  }
}

/** 原生壳 + 安装插件 + 文件系统插件都在场，才能「下载并唤起安装」。 */
export function canInstallUpdate(): boolean {
  return isNativeApp() && getApkInstaller() !== null && getFilesystem() !== null;
}

// ── 检查更新 ────────────────────────────────────────────────────────────────────

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const cur = currentVersion();
  const base: UpdateInfo = {
    hasUpdate: false,
    currentVersion: cur,
    latestVersion: null,
    downloadUrl: null,
    releaseNotes: "",
    releasePageUrl: RELEASE_PAGE_URL,
    canInstall: canInstallUpdate(),
    error: "",
  };

  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) {
      // 404 常见于「还没发过 Release」——不当错误，按「已是最新」处理但给出说明
      return {
        ...base,
        error: res.status === 404 ? "仓库还没有任何 Release" : `检查更新失败（HTTP ${res.status}）`,
      };
    }
    const rel = (await res.json()) as GitHubRelease;
    const tag = rel.tag_name || rel.name || "";
    if (!tag) return { ...base, error: "Release 缺少版本号（tag）" };

    // 找 .apk 资产
    const apk = (rel.assets || []).find((a) => (a.name || "").toLowerCase().endsWith(".apk"));
    const hasUpdate = isNewer(tag, cur);

    return {
      ...base,
      latestVersion: tag,
      downloadUrl: apk?.browser_download_url || null,
      releaseNotes: (rel.body || "").trim(),
      hasUpdate,
    };
  } catch (e) {
    return { ...base, error: e instanceof Error ? e.message : "检查更新出错" };
  }
}

// ── 下载并唤起安装 ──────────────────────────────────────────────────────────────

export type OtaProgress =
  | { phase: "downloading"; received: number; total: number | null }
  | { phase: "installing" }
  | { phase: "done" }
  | { phase: "error"; message: string };

/**
 * 下载 apk 并唤起系统安装器。仅原生壳可用（canInstallUpdate() 为真）。
 * 返回是否成功唤起安装器（true 不代表用户已安装，需用户在系统弹窗点「安装」）。
 */
export async function downloadAndInstall(
  downloadUrl: string,
  onProgress?: (p: OtaProgress) => void,
): Promise<boolean> {
  const fs = getFilesystem();
  const installer = getApkInstaller();
  if (!fs || !installer) {
    onProgress?.({ phase: "error", message: "当前环境不支持应用内安装" });
    return false;
  }

  const CACHE = "CACHE"; // @capacitor/filesystem Directory.Cache
  const fileName = `gold-update-${Date.now() % 1_000_000}.apk`;

  // 下载进度监听（filesystem 在 progress:true 时发 'progress' 事件）
  let removeProgress: (() => void) | null = null;
  try {
    if (fs.addListener) {
      const handle = await Promise.resolve(
        fs.addListener("progress", (e) => {
          onProgress?.({
            phase: "downloading",
            received: e.bytes ?? 0,
            total: e.contentLength && e.contentLength > 0 ? e.contentLength : null,
          });
        }),
      );
      removeProgress = () => handle?.remove?.();
    }
  } catch {
    /* 进度监听失败不致命，继续下载 */
  }

  try {
    onProgress?.({ phase: "downloading", received: 0, total: null });
    await fs.downloadFile({ url: downloadUrl, path: fileName, directory: CACHE, progress: true });

    // 取本地 file:// URI 交给原生安装
    const { uri } = await fs.getUri({ path: fileName, directory: CACHE });

    onProgress?.({ phase: "installing" });
    const r = await installer.installApk({ filePath: uri });
    onProgress?.({ phase: r.launched ? "done" : "error", message: r.launched ? undefined : "未能唤起安装器" } as OtaProgress);
    return r.launched === true;
  } catch (e) {
    onProgress?.({ phase: "error", message: e instanceof Error ? e.message : "下载或安装失败" });
    return false;
  } finally {
    removeProgress?.();
  }
}
