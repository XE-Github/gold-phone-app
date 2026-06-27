"use client";

// App 装机诊断页（PhoneApp）。/diag
// 用途：装机后一眼看清 4 个待实测项到底成不成，手机上零额外工具、不连电脑。
//   ① 运行环境：是否原生壳、内嵌 Node 插件是否在场、版本号、当前取数走 IPC 还是 HTTP 兑底
//   ② 三条数据源：quotes / bank-gold / history 各自成败、耗时、拿到几条、warnings
//   ③ 工行/建行老旧 TLS：从 bank-gold 的 source 字段专门标出这两个官网直连成没成（最关键实测项）
//   ④ 通知 + OTA：发一条测试通知；点检查更新看能否连上 GitHub
// 全部复用既有 src/lib（apiBase/notify/ota），不重写数据层。

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
import type { Quote } from "@/lib/types";

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

// 从 bank-gold 的 quotes 里挑出工行/建行官网直连的实测结论。
// 判定与数据层一致：source 含「工行官网」「建行官网」= 老旧 TLS 直连成功拿到真实数据。
function bankTlsVerdict(quotes: Quote[] | undefined) {
  const list = quotes ?? [];
  const icbc = list.find((q) => /工行/.test(q.source) && /官网/.test(q.source));
  const ccb = list.find((q) => /建行/.test(q.source) && /官网/.test(q.source));
  return {
    icbc: icbc ? `成功（${icbc.source}）` : "未拿到官网直连数据",
    icbcGood: Boolean(icbc),
    ccb: ccb ? `成功（${ccb.source}）` : "未拿到官网直连数据",
    ccbGood: Boolean(ccb),
  };
}

export default function Diag() {
  const [env, setEnv] = useState<ReturnType<typeof probeEnv> | null>(null);
  const [quotesR, setQuotesR] = useState<RouteResult | null>(null);
  const [bankR, setBankR] = useState<RouteResult | null>(null);
  const [historyR, setHistoryR] = useState<RouteResult | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [perm, setPerm] = useState<string>("");
  const [ota, setOta] = useState<string>("");
  // 推流探测：主页用 SSE/IPC 流取数，与 requestRoute 是不同通道。
  // 这里订阅 ~8s，看能否收到至少一帧 + 状态变迁，用于区分「传输层 vs 上游抓取」。
  const [streamR, setStreamR] = useState<{
    status: string;
    frames: number;
    firstMs: number | null;
    done: boolean;
  } | null>(null);
  const streamUnsubRef = useRef<(() => void) | null>(null);

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

  useEffect(() => {
    queueMicrotask(refreshEnv);
  }, [refreshEnv]);

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
        const anyData = data as {
          quotes?: Quote[];
          warnings?: string[];
          series?: unknown[];
          sources?: string[];
        };
        const quotes = anyData.quotes;
        const count = quotes
          ? quotes.length
          : Array.isArray(anyData.series)
            ? anyData.series.length
            : 0;
        const warnings = anyData.warnings ?? [];
        return { ok: true, ms, count, warnings, quotes };
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
      const v = bankTlsVerdict(b.quotes);
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

  const bankTls = bankR?.ok ? bankTlsVerdict(bankR.quotes) : null;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-16 pt-4 text-white">
      <h1 className="text-lg font-bold">装机诊断 · /diag</h1>
      <p className="mt-1 text-[11px] text-slate-500">
        一眼看清数据源、工行/建行直连、通知、升级是否正常。把整页截图发回即可。
      </p>

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
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              成功=内嵌 Node 的老旧 TLS 握手通了，拿到官网真实价；失败=自动回退聚合源（数据仍在，仅这两家非直连），属预期降级。
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
