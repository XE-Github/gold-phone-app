import type { CapacitorConfig } from "@capacitor/cli";

// Capacitor 配置（PhoneApp 纯安卓 App 形态）。
//
// webDir 指向 Next 静态导出产物 out/（npm run build 生成）。
// 内嵌 Node 由 @choreruiz/capacitor-node-js 承载：startMode:auto 应用启动即拉起 Node 引擎，
// nodeDir 指 public/nodejs-project（cap sync 时同步进原生 assets）。其入口由该工程 package.json 的 main 指定。
//
// 隔离：appId/appName 独立，与主项目无关。
const config: CapacitorConfig = {
  appId: "com.xegithub.goldphone",
  appName: "黄金看板",
  webDir: "out",
  plugins: {
    CapacitorNodeJS: {
      nodeDir: "nodejs-project",
      startMode: "auto",
    },
  },
  android: {
    // 允许 WebView 访问 http://localhost:3100（内嵌 Node 的 HTTP 兑底链路，明文本机回环）。
    // 主链路是 IPC，不依赖明文；此项仅为兑底链路兜底。
    allowMixedContent: true,
  },
};

export default config;
