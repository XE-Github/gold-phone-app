import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// 把文件追踪根固定到 PhoneApp 自身目录（与主项目隔离，避免 Next 把工作区根推断到上层）。
const projectRoot = dirname(fileURLToPath(import.meta.url));

// 安卓 App 形态：前端要打进 apk（Capacitor WebView 加载本地静态资源），
// 因此用静态导出（output: "export"）。静态导出会移除所有 /api 服务端路由——
// 这是预期的：数据改由「内嵌 Node（nodejs-mobile）」在 localhost:3100 提供，
// 前端经 src/lib/apiBase.ts 的 apiUrl() 指向该端口（见该文件说明）。
//
// 切换开关：BUILD_TARGET=web 时回退为普通 Next（保留 /api 路由，供浏览器/dev 调试）。
// 默认（含 CI 打 apk）走静态导出。
const isWebBuild = process.env.BUILD_TARGET === "web";

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
  ...(isWebBuild
    ? {}
    : {
        output: "export",
        // 静态导出无服务端图片优化，关闭以避免构建报错（本项目未用 next/image，留作保险）。
        images: { unoptimized: true },
      }),
};

export default nextConfig;
