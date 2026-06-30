// 银行积存金【产品清单】——纯静态数据，零运行时依赖（不 import 任何 node:* 模块）。
//
// 抽出这个文件是为了让【客户端组件】(BankGoldCompare.tsx) 能拿到银行清单/展示字段，
// 而不必 import bankGold.ts —— 后者会连带拉入 icbcDirect/ccbDirect 里的 node:https / node:crypto，
// 导致 Webpack 客户端打包报 UnhandledSchemeError（Turbopack 能摘掉、Webpack 不能）。
//
// 服务端编排 (bankGold.ts) 与客户端展示 (BankGoldCompare.tsx) 都从这里 import。

import type { BankGoldProduct } from "./types";

export type ProductDef = BankGoldProduct & {
  bankCode: string;
  huimiaoBankType: string | null;
  huimiaoCurrencyType: string | null;
  jdjrSku: string | null;
  jdjrApi?: "v1" | "v2";
  jdjrName?: string;
  spreadFallback: { sellSpread: number; buySpread: number };
};

// 展示与抓取顺序：工商 → 浙商 → 民生 → 广发 → 建设（按用户指定，勿改）。
// 仅保留这 5 家，BankGoldCompare 按本数组顺序渲染（不再价格排序），total/realCount 也据此计数。
export const BANK_GOLD_PRODUCTS: ProductDef[] = [
  {
    instrumentId: "icbc-acc-gold",
    bankName: "工商银行",
    bankCode: "ICBC",
    product: "工银积存金",
    huimiaoBankType: "ICBC",
    huimiaoCurrencyType: "Gold",
    jdjrSku: null,
    spreadFallback: { sellSpread: 3.2, buySpread: 3.2 },
    minTradeAmount: "1克起",
    spreadNote: "约6.4元/克（实测）",
    tradingHours: "以银行App官方公告为准",
  },
  {
    instrumentId: "czbank-acc-gold",
    bankName: "浙商银行",
    bankCode: "CZBANK",
    product: "涌金积存金",
    huimiaoBankType: null,
    huimiaoCurrencyType: null,
    jdjrSku: "1961543816",
    jdjrApi: "v2",
    spreadFallback: { sellSpread: 1.83, buySpread: 1.83 },
    minTradeAmount: "1克起",
    spreadNote: "卖出费率0.4%（按金额，非固定点差）",
    tradingHours: "周一至周五 09:00–23:59:59，周六 00:00–02:00",
  },
  {
    instrumentId: "cmbc-acc-gold",
    bankName: "民生银行",
    bankCode: "CMBC",
    product: "民生积存金",
    huimiaoBankType: null,
    huimiaoCurrencyType: null,
    jdjrSku: "P005",
    jdjrApi: "v1",
    spreadFallback: { sellSpread: 2.0, buySpread: 2.0 },
    minTradeAmount: "0.1克起",
    spreadNote: "约4.0元/克（实测）",
    tradingHours: "以银行App官方公告为准",
  },
  {
    instrumentId: "cgb-acc-gold",
    bankName: "广发银行",
    bankCode: "CGB",
    product: "广发积存金",
    huimiaoBankType: null,
    huimiaoCurrencyType: null,
    jdjrSku: null,
    jdjrName: "广发积存金",
    spreadFallback: { sellSpread: 1.75, buySpread: 1.75 },
    minTradeAmount: "0.1克起",
    spreadNote: "约3.5元/克（实测）",
    tradingHours: "以银行App官方公告为准",
  },
  {
    instrumentId: "ccb-acc-gold",
    bankName: "建设银行",
    bankCode: "CCB",
    product: "龙鼎金",
    huimiaoBankType: "CCB",
    huimiaoCurrencyType: "Gold",
    jdjrSku: null,
    spreadFallback: { sellSpread: 3.0, buySpread: 3.0 },
    minTradeAmount: "1克起",
    spreadNote: "约6.0元/克（实测）",
    tradingHours: "以银行App官方公告为准",
  },
];
