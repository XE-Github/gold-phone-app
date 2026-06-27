import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

// 把文件追踪根固定到 PhoneApp 自身目录（与主项目隔离，避免 Next 把工作区根推断到上层）。
const projectRoot = dirname(fileURLToPath(import.meta.url));

// 应用版本号「单一事实源」：package.json 的 version。
// 同时注入前端（NEXT_PUBLIC_APP_VERSION，供 OTA 比对）；Android versionName 也读同一处
// （见 android/app/build.gradle 的 versionName）。升级只改 package.json 一处。
const pkgVersion = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

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
  env: {
    // 编译进前端，供 OTA（src/lib/ota.ts）与 GitHub Release tag 比对版本。
    NEXT_PUBLIC_APP_VERSION: pkgVersion,
  },
  ...(isWebBuild
    ? {}
    : {
        output: "export",
        // 静态导出无服务端图片优化，关闭以避免构建报错（本项目未用 next/image，留作保险）。
        images: { unoptimized: true },
      }),
};

export default nextConfig;
