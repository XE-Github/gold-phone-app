"use client";

// ⚠️⚠️⚠️ MOCK 假数据——仅供 WEB 预览排版(?mock=1)，绝不进真机/生产。⚠️⚠️⚠️
//   触发条件：仅在 location.search 含 mock=1 时(见 quotesStream.subscribeQuotes 短路)。
//   目的：dev 无内嵌 Node 抓不到真数据，主页全是 "--" 看不出排版。这里喂一份写死的假行情，
//   让作者在浏览器里目测字号/溢出/徽章呼吸效果。每个 source 子串刻意覆盖不同时效徽章：
//     实时(呼吸) / 理论值(不呼吸) / 最新牌价(呼吸,真实) / 估算(不呼吸,灰)。
//   数值是编造的、非任何真实成交价——预览专用，不可当行情参考。

import type { QuotesPayload, Quote } from "./types";

// 行情标的（含理论金价 / 伦敦金 / 汇率 / SGE / ETF）
function marketQuotes(): Quote[] {
  const ts = "2026-06-30 21:30:45"; // 固定时间戳(预览不需要真实流动)
  return [
    {
      instrumentId: "xau-cny",
      price: 886.42,
      change: 4.18, // 已换算成 ¥
      changePercent: 0.47,
      timestamp: ts,
      source: "自动计算：XAU/USD × USD/CNY ÷ 31.1035", // → 理论值(不呼吸)
    },
    {
      instrumentId: "xau-usd",
      price: 2718.35,
      change: 12.6,
      changePercent: 0.47,
      dayHigh: 2725.1,
      dayLow: 2701.8,
      timestamp: ts,
      source: "新浪财经·伦敦金（实时）", // → 实时(呼吸)
    },
    {
      instrumentId: "usd-cny",
      price: 7.1542,
      change: -0.0031,
      changePercent: -0.04,
      timestamp: ts,
      source: "新浪财经·美元兑人民币（实时）", // → 实时(呼吸)
    },
    {
      instrumentId: "sge-au9999",
      price: 632.18,
      change: 2.9,
      changePercent: 0.46,
      timestamp: ts,
      source: "新浪财经·SGE现货（实时·真实）", // → 实时(呼吸)
    },
    {
      instrumentId: "gold-etf-518880",
      price: 8.246,
      change: 0.038,
      changePercent: 0.46,
      timestamp: ts,
      source: "新浪财经·518880华安黄金ETF（实时）", // → 实时(呼吸)
    },
  ];
}

// 银行积存金（5 家：工商/浙商/民生/广发/建设；混真实徽章与估算徽章）
function bankQuotes(): Quote[] {
  const ts = "2026-06-30 21:30:12";
  return [
    {
      instrumentId: "icbc-acc-gold",
      price: 636.5,
      bid: 632.1,
      ask: 636.5,
      timestamp: ts,
      source: "工商银行官网 · 工商银行如意金积存", // → 官网直连(最新牌价,呼吸)
    },
    {
      instrumentId: "czbank-acc-gold",
      price: 635.8,
      bid: 631.5,
      ask: 635.8,
      timestamp: ts,
      source: "京东积存金实时数据 · 浙商银行积存金", // → 京东平台(最新牌价,呼吸)
    },
    {
      instrumentId: "cmbc-acc-gold",
      price: 637.2,
      bid: 632.8,
      ask: 637.2,
      timestamp: ts,
      source: "汇喵金融实时数据 · 民生银行积存金（点差¥4.40）", // → 第三方聚合(最新牌价,呼吸)
    },
    {
      instrumentId: "cgb-acc-gold",
      price: 638.0,
      bid: 633.5,
      ask: 638.0,
      timestamp: ts,
      source: "京东积存金实时数据 · 广发银行积存金", // → 京东平台
    },
    {
      instrumentId: "ccb-acc-gold",
      price: 636.9,
      bid: 632.4,
      ask: 636.9,
      timestamp: ts,
      source: "基于SGE Au99.99真实价+银行点差估算 · 建设银行龙鼎金", // → 估算(灰,不呼吸)
    },
  ];
}

// 是否启用 mock（仅浏览器 + URL 带 mock=1）
export function isMockMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("mock");
}

// 完整假 payload（行情 + 积存金合并，与推流形态一致）
export function mockPayload(): QuotesPayload {
  const banks = bankQuotes();
  const realCount = banks.filter(
    (q) => q.source.includes("官网") || q.source.includes("京东积存金") || q.source.includes("汇喵"),
  ).length;
  return {
    quotes: [...marketQuotes(), ...banks],
    warnings: ["⚠️ 当前为 MOCK 预览数据（?mock=1），数值为编造、非真实行情，仅供排版预览。"],
    serverTime: 1782826245000, // 固定：2026-06-30 21:30:45 CST
    bankRealCount: realCount,
    bankTotal: banks.length,
  };
}
