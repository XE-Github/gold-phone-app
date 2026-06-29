"use client";

// App 装机诊断面板（PhoneApp）。
// 用途：装机后一眼看清 4 个待实测项到底成不成，手机上零额外工具、不连电脑。
//   ① 运行环境：是否原生壳、内嵌 Node 插件是否在场、版本号、当前取数走 IPC 还是 HTTP 兑底
//   ② 三条数据源：quotes / bank-gold / history 各自成败、耗时、拿到几条、warnings
//   ③ 工行/建行老旧 TLS：从 bank-gold 的 source 字段专门标出这两个官网直连成没成（最关键实测项）
//   ④ 通知 + OTA：发一条测试通知；点检查更新看能否连上 GitHub
// 全部复用既有 src/lib（apiBase/notify/ota），不重写数据层。
//
// ⚠️ 为什么是组件而非独立路由页：静态导出(output:export)产出扁平 diag.html，主页用
// <a href="/diag"> 跳转在 Capacitor file:// 下找不到该文件 → App 里打不开(PC dev 正常)。
// 故主页改为「同页全屏弹层」打开本面板(onClose 传入即弹层模式)，彻底绕开路由跳转。
// 本文件的 page.tsx 路由壳仅供 PC 浏览器 dev 直接访问 /diag 调试用。

import { useCallback, useEffect, useRef, useState } from "react";
import { isNativeApp, requestRoute, subscribeStream } from "@/lib/apiBase";
import {
  notificationSupported,
  notificationPermission,
  requestNotificationPermission,
  showSystemNotification,
  isNativeNotify,
} from "@/lib/notify";
import { checkForUpdate, currentVersion, canInstallUpdate } from "@/lib/ota";
import {
  getConsent,
  peekDeviceId,
  getModel,
  getLocalEventLog,
} from "@/lib/analytics";
import type { Quote, BankDirectDiag } from "@/lib/types";

// ── 运行环境探测（不静态依赖 Capacitor，运行期读 window） ──
function probeEnv() {
  const cap =
    typeof window !== "undefined"
      ? (window as unknown as {
          Capacitor?: {
            getPlatform?: () => string;
            isNativePlatform?: () => boolean;
            Plugins?: Record<string, unknown>;
          };
        }).Capacitor
      : undefined;
  const plugins = cap?.Plugins ?? {};
  return {
    native: isNativeApp(),
    platform: cap?.getPlatform?.() ?? "(无 Capacitor，应为浏览器)",
    hasNodePlugin: Boolean((plugins as Record<string, unknown>).CapacitorNodeJS),
    hasLocalNotif: Boolean((plugins as Record<string, unknown>).LocalNotifications),
    hasFilesystem: Boolean((plugins as Record<string, unknown>).Filesystem),
    hasApkInstaller: Boolean((plugins as Record<string, unknown>).ApkInstaller),
    transport: isNativeApp()
      ? (plugins as Record<string, unknown>).CapacitorNodeJS
        ? "IPC（内嵌 Node 插件在场）"
        : "HTTP 兑底（插件不在场，落 localhost:3100）"
      : "同源 fetch（浏览器/dev）",
    version: currentVersion(),
    canInstall: canInstallUpdate(),
  };
}

type RouteResult = {
  ok: boolean;
  ms: number;
  count: number;
  warnings: string[];
  error?: string;
  quotes?: Quote[];
  // bank-gold 专有：工行/建行官网直连诊断证据，用于 ③ 显示失败具体原因 + 设备实收内容。
  bankDirectDiag?: { icbc: BankDirectDiag; ccb: BankDirectDiag };
};

function Row({ k, v, good }: { k: string; v: string; good?: boolean | null }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 text-sm">
      <span className="shrink-0 text-slate-400">{k}</span>
      <span
        className={`text-right tabular-nums font-medium ${
          good === true ? "text-emerald-300" : good === false ? "text-rose-300" : "text-slate-200"
        }`}
      >
        {v}
      </span>
    </div>
  );
}

// 行情关键标的实际值（用于判断「数据没显示」到底是全挂还是部分挂）。
// 列出每个标的：拿到价没、价格、来源。某行 price=null 即该标的没数据。
const KEY_INSTRUMENTS: { id: string; label: string; digits: number; prefix: string }[] = [
  { id: "xau-usd", label: "伦敦金 XAU/USD", digits: 2, prefix: "$" },
  { id: "usd-cny", label: "美元兑人民币", digits: 4, prefix: "" },
  { id: "xau-cny", label: "人民币理论金价", digits: 2, prefix: "¥" },
  { id: "sge-au9999", label: "Au99.99 现货", digits: 2, prefix: "¥" },
  { id: "sge-autd", label: "Au(T+D)", digits: 2, prefix: "¥" },
  { id: "shfe-au-main", label: "沪金主力", digits: 2, prefix: "¥" },
];

function instrumentRows(quotes: Quote[] | undefined) {
  const map = new Map<string, Quote>();
  for (const q of quotes ?? []) map.set(q.instrumentId, q);
  return KEY_INSTRUMENTS.map((m) => {
    const q = map.get(m.id);
    const has = q != null && Number.isFinite(q.price) && q.price > 0;
    return {
      label: m.label,
      has,
      value: has ? `${m.prefix}${q!.price.toFixed(m.digits)}` : "—（无数据）",
      source: q?.source ?? "",
    };
  });
}

// 把直连失败原因码翻成人话：EPROTO=设备 OpenSSL 不支持老旧握手（最关心的判别点）；
// 超时/DNS=网络或环境；HTTP xxx=连上但被拒；no-data/no-cookie/ok=连上但没解出有效数据。
function reasonText(code: string | undefined): string {
  if (!code) return "未拿到官网直连数据";
  if (code === "EPROTO") return "未拿到（EPROTO：设备 OpenSSL 不支持老旧握手）";
  if (code === "ETIMEDOUT" || code === "timeout") return "未拿到（超时）";
  if (code === "ENOTFOUND") return "未拿到（DNS 解析失败）";
  if (code === "ECONNRESET" || code === "ECONNREFUSED") return `未拿到（${code}：连接被断/拒）`;
  if (code.startsWith("HTTP ")) return `未拿到（${code}）`;
  if (code === "no-cookie") return "未拿到（连上但没拿到会话 cookie）";
  if (code === "no-data" || code === "ok") return "未拿到（连上但无有效数据）";
  return `未拿到（${code}）`;
}

// v0.1.11：失败时把设备「实际收到了什么」拼成一句证据（HTTP 状态/字节/类型/重定向/片段），
// 用于区分被 WAF 拦的挑战页、空体、重定向没跟等真实成因（握手通了才会有这些）。
function evidenceText(diag?: BankDirectDiag): string {
  if (!diag) return "";
  const parts: string[] = [];
  if (typeof diag.httpStatus === "number" && diag.httpStatus > 0) parts.push(`HTTP${diag.httpStatus}`);
  if (typeof diag.bytes === "number") parts.push(`${diag.bytes}字节`);
  if (diag.contentType) parts.push(diag.contentType.split(";")[0]);
  if (diag.location) parts.push(`→${diag.location}`);
  const head = parts.join("，");
  const snip = diag.snippet ? `“${diag.snippet}”` : "";
  if (head && snip) return `设备实收：${head}；${snip}`;
  if (head) return `设备实收：${head}`;
  if (snip) return `设备实收：${snip}`;
  return "";
}

// 完整失败结论：主因 + 设备实收证据（有则附在后面）。
function bankFailReason(diag?: BankDirectDiag): string {
  const main = reasonText(diag?.code);
  const ev = evidenceText(diag);
  return ev ? `${main}｜${ev}` : main;
}

// 从 bank-gold 的 quotes 里挑出工行/建行官网直连的实测结论。
// 判定与数据层一致：source 含「工行官网」「建行官网」= 老旧 TLS 直连成功拿到真实数据。
// diag（来自 payload.bankDirectDiag）在失败时给出具体原因 + 设备实收证据。
function bankTlsVerdict(
  quotes: Quote[] | undefined,
  diag?: { icbc: BankDirectDiag; ccb: BankDirectDiag },
) {
  const list = quotes ?? [];
  // ⚠️ 按 instrumentId + source 含「官网」判定，不要用 /工行/、/建行/ 子串匹配：
  // 真实 source 是「工商银行官网…」「建设银行官网…」，不含「工行」「建行」字样，
  // 旧正则恒不匹配 → 即使直连成功也误判为 ✗（v0.1.12 修）。
  const icbc = list.find((q) => q.instrumentId === "icbc-acc-gold" && /官网/.test(q.source));
  const ccb = list.find((q) => q.instrumentId === "ccb-acc-gold" && /官网/.test(q.source));
  return {
    icbc: icbc ? `成功（${icbc.source}）` : bankFailReason(diag?.icbc),
    icbcGood: Boolean(icbc),
    ccb: ccb ? `成功（${ccb.source}）` : bankFailReason(diag?.ccb),
    ccbGood: Boolean(ccb),
  };
}

// onClose 传入即「弹层模式」：顶部显示关闭条，内容不套全屏 <main>（由外层弹层负责）。
// 不传则「整页模式」：套 <main> + 安全区，供 /diag 路由页(PC dev 调试)直接渲染。
export function DiagPanel({ onClose }: { onClose?: () => void } = {}) {
  const [env, setEnv] = useState<ReturnType<typeof probeEnv> | null>(null);
  const [quotesR, setQuotesR] = useState<RouteResult | null>(null);
  const [bankR, setBankR] = useState<RouteResult | null>(null);
  const [historyR, setHistoryR] = useState<RouteResult | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [perm, setPerm] = useState<string>("");
  const [ota, setOta] = useState<string>("");
  // 一键复制：把整页探测结果汇成纯文本。copyHint 提示复制成败；
  // reportText 非空时在页面渲染一个只读 textarea 作兜底（clipboard API 不可用时长按全选复制）。
  const [copyHint, setCopyHint] = useState<string>("");
  const [reportText, setReportText] = useState<string>("");
  // 推流探测：主页用 SSE/IPC 流取数，与 requestRoute 是不同通道。
  // 这里订阅 ~8s，看能否收到至少一帧 + 状态变迁，用于区分「传输层 vs 上游抓取」。
  const [streamR, setStreamR] = useState<{
    status: string;
    frames: number;
    firstMs: number | null;
    done: boolean;
  } | null>(null);
  const streamUnsubRef = useRef<(() => void) | null>(null);

  // 本机埋点预览（阶段 1）：看同意状态 / 设备标识 / 型号 / 已记录事件数。
  // 只读本地，不触发任何上报；URL 阶段 1 为空，事件仅记本地环形缓冲。
  const [analytics, setAnalytics] = useState<{
    consent: string;
    did: string;
    model: string;
    eventCount: number;
    lastEvents: string[];
  } | null>(null);

  const append = useCallback((line: string) => {
    setLog((prev) => [
      `${new Date().toLocaleTimeString("zh-CN", { hour12: false })}  ${line}`,
      ...prev,
    ]);
  }, []);

  const refreshEnv = useCallback(() => {
    setEnv(probeEnv());
    setPerm(notificationPermission());
  }, []);

  const refreshAnalytics = useCallback(async () => {
    try {
      const log = getLocalEventLog();
      const last = log
        .slice(-5)
        .map((e) => {
          const t = new Date(e.ts).toLocaleTimeString("zh-CN", { hour12: false });
          const tag = e.event === "ota_action" && e.ext ? `ota_action:${String((e.ext as Record<string, unknown>).ota ?? "")}` : e.event;
          return `${t} ${tag} (${e.ver})`;
        })
        .reverse();
      setAnalytics({
        consent: getConsent(),
        did: peekDeviceId() ?? "（未生成，需先同意）",
        model: await getModel(),
        eventCount: log.length,
        lastEvents: last,
      });
    } catch {
      /* 预览失败不致命 */
    }
  }, []);

  useEffect(() => {
    queueMicrotask(refreshEnv);
    queueMicrotask(() => void refreshAnalytics());
  }, [refreshEnv, refreshAnalytics]);

  // 单条路由探测：计时 + 计数 + 收 warnings，绝不抛（出错落 error 字段）。
  const probeRoute = useCallback(
    async (
      route: "/api/quotes" | "/api/bank-gold" | "/api/history",
    ): Promise<RouteResult> => {
      const t0 = performance.now();
      try {
        const data = await requestRoute(route);
        const ms = Math.round(performance.now() - t0);
        // quotes/bank-gold 有 quotes[]；history 是 {series, sources}
        // ⚠️ history 的 series 是 Record<标的id, Point[]>（对象，不是数组）——
        // 旧代码 Array.isArray(series) 恒 false → count 恒 0（误报 history 永远空）。
        // 正确口径：所有标的的分时点数之和（拿到几个分时点）。
        const anyData = data as {
          quotes?: Quote[];
          warnings?: string[];
          series?: Record<string, unknown[]>;
          sources?: Record<string, string>;
          bankDirectDiag?: { icbc: BankDirectDiag; ccb: BankDirectDiag };
        };
        const quotes = anyData.quotes;
        let count: number;
        if (quotes) {
          count = quotes.length;
        } else if (anyData.series && typeof anyData.series === "object") {
          count = Object.values(anyData.series).reduce(
            (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
            0,
          );
        } else {
          count = 0;
        }
        const warnings = anyData.warnings ?? [];
        return { ok: true, ms, count, warnings, quotes, bankDirectDiag: anyData.bankDirectDiag };
      } catch (e) {
        const ms = Math.round(performance.now() - t0);
        return {
          ok: false,
          ms,
          count: 0,
          warnings: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    },
    [],
  );

  // 推流探测：订阅 ~8s。收到至少一帧含 quotes 即「推流通」；
  // 全程只 connecting/polling 且零帧 → 推流不通（主页会靠 5s 轮询兜底）。
  const probeStream = useCallback(() => {
    streamUnsubRef.current?.(); // 清掉上一轮
    const t0 = performance.now();
    let frames = 0;
    let firstMs: number | null = null;
    let status = "connecting";
    setStreamR({ status, frames, firstMs, done: false });
    append("开始探测推流（subscribeStream，约 8s）…");

    const unsub = subscribeStream(
      (payload) => {
        if (Array.isArray(payload.quotes)) {
          frames += 1;
          if (firstMs === null) firstMs = Math.round(performance.now() - t0);
          status = "connected";
          setStreamR({ status, frames, firstMs, done: false });
        }
      },
      (s) => {
        status = s;
        setStreamR((prev) => ({
          status: s,
          frames: prev?.frames ?? frames,
          firstMs: prev?.firstMs ?? firstMs,
          done: prev?.done ?? false,
        }));
      },
    );
    streamUnsubRef.current = unsub;

    window.setTimeout(() => {
      unsub();
      streamUnsubRef.current = null;
      setStreamR({ status, frames, firstMs, done: true });
      append(
        frames > 0
          ? `推流探测 → 通：收到 ${frames} 帧（首帧 ${firstMs}ms）`
          : `推流探测 → 未收到帧（状态 ${status}）；主页靠 5s 轮询兜底`,
      );
    }, 8000);
  }, [append]);

  const runAll = useCallback(async () => {
    setRunning(true);
    refreshEnv();
    append("开始探测三条数据源…");

    const q = await probeRoute("/api/quotes");
    setQuotesR(q);
    append(`行情 /api/quotes → ${q.ok ? `成功 ${q.count} 条 / ${q.ms}ms` : `失败：${q.error}`}`);

    const b = await probeRoute("/api/bank-gold");
    setBankR(b);
    append(`积存金 /api/bank-gold → ${b.ok ? `成功 ${b.count} 条 / ${b.ms}ms` : `失败：${b.error}`}`);

    const h = await probeRoute("/api/history");
    setHistoryR(h);
    append(`历史 /api/history → ${h.ok ? `成功 ${h.count} 条 / ${h.ms}ms` : `失败：${h.error}`}`);

    if (b.ok) {
      const v = bankTlsVerdict(b.quotes, b.bankDirectDiag);
      append(`工行官网直连：${v.icbc}`);
      append(`建行官网直连：${v.ccb}`);
    }
    setRunning(false);
    probeStream(); // 三条单次探完后，测一次推流通道
  }, [append, probeRoute, refreshEnv, probeStream]);

  // 进页面自动跑一轮
  useEffect(() => {
    queueMicrotask(() => void runAll());
    return () => {
      streamUnsubRef.current?.();
      streamUnsubRef.current = null;
    };
  }, [runAll]);

  async function onReqNotify() {
    const r = await requestNotificationPermission();
    setPerm(notificationPermission());
    append(`请求通知权限 → ${r}`);
  }
  async function onTestNotify() {
    const ok = await showSystemNotification("测试通知", "装机通知测试 ✅ 看到这条就成功了");
    append(`发测试通知 → ${ok ? "已递交（true）" : "未递交（false，多半未授权）"}`);
    setPerm(notificationPermission());
  }
  async function onCheckOta() {
    setOta("检查中…");
    const r = await checkForUpdate();
    if (r.error) {
      setOta(`检查更新：${r.error}`);
      append(`OTA 检查 → ${r.error}`);
    } else {
      const s = r.hasUpdate
        ? `发现新版 ${r.latestVersion}（当前 v${r.currentVersion}）`
        : `已最新（当前 v${r.currentVersion}${r.latestVersion ? `，远端 ${r.latestVersion}` : ""}）`;
      setOta(s);
      append(`OTA 检查 → ${s}；可应用内安装=${r.canInstall}`);
    }
  }

  // 把整页探测结果汇成一段结构化纯文本，供复制后粘贴回报。
  const buildReport = useCallback((): string => {
    const lines: string[] = [];
    const yn = (b: boolean | null | undefined) =>
      b === true ? "✓" : b === false ? "✗" : "·";
    lines.push("===== PhoneApp 装机诊断 /diag =====");

    // ① 运行环境
    lines.push("");
    lines.push("【① 运行环境】");
    if (env) {
      lines.push(`原生壳(apk): ${env.native ? "是" : "否(浏览器)"}`);
      lines.push(`平台: ${env.platform}`);
      lines.push(`取数链路: ${env.transport}`);
      lines.push(`内嵌Node插件: ${yn(env.hasNodePlugin)} ${env.hasNodePlugin ? "在场" : "不在场"}`);
      lines.push(`通知插件: ${yn(env.hasLocalNotif)} / 文件系统: ${yn(env.hasFilesystem)} / 安装器: ${yn(env.hasApkInstaller)}`);
      lines.push(`App版本: v${env.version}`);
    } else {
      lines.push("(环境未读取)");
    }

    // ② 数据源
    const fmt = (r: RouteResult | null) =>
      !r ? "未探测" : r.ok ? `成功 ${r.count}条 / ${r.ms}ms` : `失败 ${r.ms}ms：${r.error ?? ""}`;
    lines.push("");
    lines.push("【② 数据源】");
    lines.push(`行情 quotes: ${fmt(quotesR)}`);
    lines.push(`积存金 bank-gold: ${fmt(bankR)}`);
    lines.push(`历史 history: ${fmt(historyR)}`);

    // 关键标的逐项值（区分全挂 vs 部分挂的核心证据）
    if (quotesR?.ok) {
      lines.push("");
      lines.push("关键标的实际值:");
      for (const row of instrumentRows(quotesR.quotes)) {
        lines.push(`  ${yn(row.has)} ${row.label}: ${row.value}${row.source ? `  [${row.source}]` : ""}`);
      }
    }
    // 行情 warnings 原文（定位「新浪主源不可用」是单挂还是连国际源也挂）
    if (quotesR?.ok && quotesR.warnings.length > 0) {
      lines.push("");
      lines.push("行情警告原文:");
      for (const w of quotesR.warnings) lines.push(`  · ${w}`);
    }
    if (bankR?.ok && bankR.warnings.length > 0) {
      lines.push("");
      lines.push("积存金警告原文:");
      for (const w of bankR.warnings) lines.push(`  · ${w}`);
    }

    // ②b 推流
    lines.push("");
    lines.push("【②b 推流通道】");
    if (!streamR) lines.push("未探测");
    else if (!streamR.done) lines.push(`测试中(${streamR.status}，已收 ${streamR.frames} 帧)`);
    else lines.push(streamR.frames > 0 ? `通：收到 ${streamR.frames} 帧(首帧 ${streamR.firstMs}ms)` : `未收到帧(状态 ${streamR.status})`);

    // ③ 工行/建行 TLS
    lines.push("");
    lines.push("【③ 工行/建行老旧TLS直连】");
    if (!bankR) lines.push("未探测");
    else if (!bankR.ok) lines.push("积存金接口未成功，无法判定");
    else {
      const v = bankTlsVerdict(bankR.quotes, bankR.bankDirectDiag);
      lines.push(`${yn(v.icbcGood)} 工行: ${v.icbc}`);
      lines.push(`${yn(v.ccbGood)} 建行: ${v.ccb}`);
    }

    // ④ 通知 / OTA
    lines.push("");
    lines.push("【④ 通知 / 升级】");
    lines.push(`通知类型: ${isNativeNotify() ? "系统原生" : "Web/SW"}`);
    lines.push(`通知权限: ${perm || notificationPermission()}`);
    lines.push(`支持通知: ${notificationSupported()}`);
    if (ota) lines.push(`OTA 检查: ${ota}`);

    // ⑤ 本机埋点（阶段 1：只本地记录，URL 空不上传）
    lines.push("");
    lines.push("【⑤ 本机埋点(匿名统计)】");
    if (!analytics) {
      lines.push("(未读取)");
    } else {
      const c =
        analytics.consent === "granted"
          ? "已同意"
          : analytics.consent === "declined"
            ? "已拒绝"
            : "未决定";
      lines.push(`同意状态: ${c}`);
      lines.push(`设备标识(匿名): ${analytics.did}`);
      lines.push(`设备型号: ${analytics.model}`);
      lines.push(`本地已记录事件: ${analytics.eventCount} 条（阶段1只本地、不上传）`);
      if (analytics.lastEvents.length > 0) {
        lines.push("最近事件:");
        for (const e of analytics.lastEvents) lines.push(`  · ${e}`);
      }
    }

    // 操作日志（最新在上，原样附）。
    if (log.length > 0) {
      lines.push("");
      lines.push("【操作日志(最新在上)】");
      for (const l of log) lines.push(l);
    }

    lines.push("");
    lines.push("===== 报告结束 =====");
    return lines.join("\n");
  }, [env, quotesR, bankR, historyR, streamR, perm, ota, log, analytics]);

  // 纯 App 内完成：永远把全文渲染进页面文本框（不依赖剪贴板 API 是否可用），
  // 同时尽力写一次剪贴板作为加成。这样无论 WebView 剪贴板行不行，用户都能拿到全文。
  const onCopyReport = useCallback(async () => {
    const text = buildReport();
    setReportText(text); // 关键：先无条件把全文显示出来
    let clipboardOk = false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        clipboardOk = true;
      }
    } catch {
      clipboardOk = false;
    }
    setCopyHint(
      clipboardOk
        ? "已复制到剪贴板 ✅ 全文也显示在下方框里。粘贴(或长按框内全选复制)发我即可。"
        : "全文已显示在下方框里。长按框内文字 → 全选 → 复制，发我即可。",
    );
    append(`生成诊断报告 → ${clipboardOk ? "已写剪贴板 + 显示全文" : "显示全文(剪贴板不可用)"}`);
  }, [buildReport, append]);

  const bankTls = bankR?.ok ? bankTlsVerdict(bankR.quotes, bankR.bankDirectDiag) : null;

  const overlay = typeof onClose === "function";
  return (
    <main
      className={`mx-auto w-full max-w-md text-white ${overlay ? "px-4 pb-16" : "min-h-dvh px-4 pb-16"}`}
      // 顶部留安全区(刘海/状态栏)+ 16px，防标题/按钮被遮挡
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">装机诊断</h1>
        {overlay && (
          <button
            onClick={onClose}
            className="min-h-9 shrink-0 rounded-lg border border-white/10 px-3 text-sm text-slate-300 active:bg-white/10"
          >
            ✕ 关闭
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        一眼看清数据源、工行/建行直连、通知、升级是否正常。诊断跑完后，点下方按钮生成全文，复制发回即可。
      </p>

      {/* 生成诊断报告：全在 App 内——点一下即把全文渲染进下方文本框(不依赖剪贴板)，并尽力写一次剪贴板。
          注意：按钮【始终可点、文字不变】。探测中也能点(生成当前快照)，避免被「探测中」盖住让人误以为没按钮。
          仅在按钮上方用一行小字提示是否还在探测。 */}
      <button
        onClick={() => void onCopyReport()}
        className="mt-3 min-h-[44px] w-full rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950 active:bg-amber-400"
      >
        📋 生成诊断报告 · 复制
      </button>
      <p className="mt-1 text-[11px] text-slate-500">
        {running
          ? "正在探测…（最长约 8 秒）。可等跑完再点上面按钮，结果更全；现在点也能拿到当前快照。"
          : "探测已完成。点上面按钮生成全文 → 复制发我。"}
      </p>
      {copyHint && (
        <p className="mt-2 text-[11px] leading-relaxed text-emerald-300">{copyHint}</p>
      )}
      {reportText && (
        <div className="mt-2">
          <textarea
            readOnly
            value={reportText}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            rows={18}
            className="w-full select-all rounded-xl border border-amber-400/30 bg-slate-950/80 p-2 text-[11px] leading-relaxed text-slate-200"
          />
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            点框内任意处即全选；长按 → 复制(或顶部弹出的「全选/复制」)。把这段发我即可。
          </p>
        </div>
      )}

      {/* ① 运行环境 */}
      <h2 className="mt-4 mb-1 text-sm font-semibold text-amber-300">① 运行环境</h2>
      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        {!env ? (
          <p className="text-sm text-slate-400">读取中…</p>
        ) : (
          <>
            <Row k="原生壳 (apk)" v={env.native ? "是" : "否（浏览器）"} good={env.native ? true : null} />
            <Row k="平台 platform" v={env.platform} />
            <Row k="当前取数链路" v={env.transport} good={env.hasNodePlugin ? true : null} />
            <Row k="内嵌 Node 插件" v={env.hasNodePlugin ? "在场" : "不在场"} good={env.hasNodePlugin} />
            <Row k="通知插件 LocalNotifications" v={env.hasLocalNotif ? "在场" : "不在场"} good={env.hasLocalNotif} />
            <Row k="文件系统插件 Filesystem" v={env.hasFilesystem ? "在场" : "不在场"} good={env.hasFilesystem} />
            <Row k="安装器插件 ApkInstaller" v={env.hasApkInstaller ? "在场" : "不在场"} good={env.hasApkInstaller} />
            <Row k="App 版本" v={`v${env.version}`} />
          </>
        )}
      </section>

      {/* ② 数据源 */}
      <h2 className="mt-4 mb-1 text-sm font-semibold text-amber-300">② 数据源</h2>
      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <DataRow name="行情 quotes" r={quotesR} />
        <DataRow name="积存金 bank-gold" r={bankR} />
        <DataRow name="历史 history" r={historyR} />

        {/* 行情 warnings 原文：定位「新浪主源不可用」到底是 sina 单挂还是 Gold-API 也挂 */}
        {quotesR?.ok && quotesR.warnings.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium text-amber-300/90">行情警告原文</p>
            <div className="rounded-lg bg-slate-950/50 p-2 text-[11px] leading-relaxed text-amber-200/80">
              {quotesR.warnings.map((w, i) => (
                <p key={i}>· {w}</p>
              ))}
            </div>
          </div>
        )}

        {/* 关键标的实际值：哪些有价、哪些是「无数据」，一眼看清「数据没显示」是全挂还是部分挂 */}
        {quotesR?.ok && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium text-slate-400">关键标的实际值（拿到价=绿，无数据=红）</p>
            <div className="rounded-lg bg-slate-950/40 px-2">
              {instrumentRows(quotesR.quotes).map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-2 border-b border-white/5 py-1.5 text-[11px] last:border-0"
                >
                  <span className="shrink-0 text-slate-400">{row.label}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    {row.source && (
                      <span className="truncate text-[10px] text-slate-600">{row.source}</span>
                    )}
                    <span
                      className={`shrink-0 tabular-nums font-medium ${
                        row.has ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      {row.value}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 积存金 warnings 原文 */}
        {bankR?.ok && bankR.warnings.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-medium text-amber-300/90">积存金警告原文</p>
            <div className="rounded-lg bg-slate-950/50 p-2 text-[11px] leading-relaxed text-amber-200/80">
              {bankR.warnings.map((w, i) => (
                <p key={i}>· {w}</p>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ②b 推流通道：主页靠它实时刷新；它不通则退化为 5s 轮询 */}
      <h2 className="mt-4 mb-1 text-sm font-semibold text-amber-300">②b 推流通道</h2>
      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        {!streamR ? (
          <p className="text-sm text-slate-400">待数据源探测完成后自动测试…</p>
        ) : (
          <>
            <Row
              k="推流状态"
              v={
                streamR.done
                  ? streamR.frames > 0
                    ? `通（收到 ${streamR.frames} 帧）`
                    : `未收到帧（${streamR.status}）`
                  : `测试中…（${streamR.status}，已收 ${streamR.frames} 帧）`
              }
              good={streamR.done ? streamR.frames > 0 : null}
            />
            {streamR.firstMs !== null && (
              <Row k="首帧耗时" v={`${streamR.firstMs}ms`} good={null} />
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              通=主页实时推送正常；未收到帧=推流通道没起来，主页会自动退化为每 5 秒轮询一次（数据仍会显示，只是不实时）。
              若上方②行情本身就 0 条/失败，则与推流无关，是上游抓取问题。
            </p>
          </>
        )}
      </section>

      {/* ③ 工行/建行老旧 TLS（最关键实测项） */}
      <h2 className="mt-4 mb-1 text-sm font-semibold text-amber-300">
        ③ 工行/建行老旧 TLS 直连
      </h2>
      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        {!bankR ? (
          <p className="text-sm text-slate-400">待积存金探测完成…</p>
        ) : !bankR.ok ? (
          <p className="text-sm text-rose-300">积存金接口未成功，无法判定（见上方错误）</p>
        ) : bankTls ? (
          <>
            <Row k="工行官网直连" v={bankTls.icbc} good={bankTls.icbcGood} />
            <Row k="建行官网直连" v={bankTls.ccb} good={bankTls.ccbGood} />
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              成功=内嵌 Node 的老旧 TLS 握手通了，拿到官网真实价；失败=自动回退聚合源（数据仍在，仅这两家非直连），属预期降级。
              失败时「｜设备实收」后是这台设备实际收到的内容（HTTP 状态/字节/类型/重定向/片段）——
              EPROTO=握手不支持；HTTP200+HTML 片段=多半被拦或拿到验证页；带「→」=有重定向。把这行一并截图回报即可定位。
            </p>
          </>
        ) : null}
      </section>

      {/* ④ 通知 + OTA */}
      <h2 className="mt-4 mb-1 text-sm font-semibold text-amber-300">④ 通知 / 升级</h2>
      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        <Row k="通知类型" v={isNativeNotify() ? "系统原生（已绕开浏览器 denied）" : "Web/SW"} good={isNativeNotify() ? true : null} />
        <Row
          k="通知权限"
          v={perm || notificationPermission()}
          good={perm === "granted" ? true : perm === "denied" ? false : null}
        />
        <Row k="支持通知" v={String(notificationSupported())} good={notificationSupported()} />
        {ota && <Row k="OTA 检查结果" v={ota} />}
        <div className="mt-3 grid grid-cols-1 gap-2">
          <button
            onClick={onReqNotify}
            className="min-h-[44px] rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950 active:bg-amber-400"
          >
            ① 请求通知权限
          </button>
          <button
            onClick={onTestNotify}
            className="min-h-[44px] rounded-xl bg-emerald-500/20 px-4 text-sm font-semibold text-emerald-200 active:bg-emerald-500/30"
          >
            ② 发一条测试通知
          </button>
          <button
            onClick={onCheckOta}
            className="min-h-[44px] rounded-xl bg-sky-500/20 px-4 text-sm font-semibold text-sky-200 active:bg-sky-500/30"
          >
            ③ 检查更新（测 GitHub 连通）
          </button>
        </div>
      </section>

      {/* ⑤ 本机埋点（匿名统计预览，阶段 1 只本地不上传） */}
      <h2 className="mt-4 mb-1 text-sm font-semibold text-amber-300">⑤ 本机埋点（匿名统计）</h2>
      <section className="rounded-2xl border border-white/10 bg-white/[0.06] p-4">
        {!analytics ? (
          <p className="text-sm text-slate-400">读取中…</p>
        ) : (
          <>
            <Row
              k="同意状态"
              v={
                analytics.consent === "granted"
                  ? "已同意"
                  : analytics.consent === "declined"
                    ? "已拒绝"
                    : "未决定"
              }
              good={analytics.consent === "granted" ? true : analytics.consent === "declined" ? false : null}
            />
            <Row k="设备标识(匿名)" v={analytics.did} good={null} />
            <Row k="设备型号" v={analytics.model} good={null} />
            <Row k="本地已记录事件" v={`${analytics.eventCount} 条`} good={null} />
            {analytics.lastEvents.length > 0 && (
              <div className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-slate-400">
                <p className="text-slate-500">最近事件：</p>
                {analytics.lastEvents.map((e, i) => (
                  <p key={i} className="tabular-nums">· {e}</p>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
              当前为阶段 1：事件只记在本机、<strong className="text-slate-300">不上传</strong>。
              「设备标识」是首次同意后随机生成的匿名 ID（非手机序列号），用于去重统计活跃。
              接通后台后才会把这些匿名事件上报，用于看大致的活跃与升级情况。
            </p>
            <button
              onClick={() => void refreshAnalytics()}
              className="mt-3 min-h-9 rounded-xl border border-white/10 px-4 text-sm text-slate-300 active:bg-white/5"
            >
              刷新埋点预览
            </button>
          </>
        )}
      </section>

      <button
        onClick={() => void runAll()}
        disabled={running}
        className="mt-4 min-h-[44px] w-full rounded-xl border border-white/10 px-4 text-sm text-slate-300 disabled:opacity-50"
      >
        {running ? "探测中…" : "重新探测全部"}
      </button>

      {log.length > 0 && (
        <section className="mt-3 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
          <p className="mb-1 text-[11px] text-slate-500">操作日志（最新在上）</p>
          <div className="space-y-1 text-[11px] tabular-nums text-slate-300">
            {log.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function DataRow({ name, r }: { name: string; r: RouteResult | null }) {
  if (!r) return <Row k={name} v="探测中…" good={null} />;
  if (!r.ok) return <Row k={name} v={`失败 / ${r.ms}ms`} good={false} />;
  return <Row k={name} v={`成功 ${r.count} 条 / ${r.ms}ms`} good={true} />;
}
