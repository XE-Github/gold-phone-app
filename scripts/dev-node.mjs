// dev 调试用：在本机直接跑内嵌 Node 的 HTTP 服务（embeddedServer），监听 127.0.0.1:3100。
//
// 删除 Next 的 /api 路由后，dev 调试由本脚本提供数据：
//   终端A：npm run dev:node   （本脚本，起数据服务 3100）
//   终端B：npm run dev        （Next 前端 3100→改用其它端口或设 base）
// 前端经 NEXT_PUBLIC_API_BASE=http://localhost:3100 指向本服务（见 .env 说明）。
//
// 用 esbuild 即时打包 + 执行 embeddedServer，避免单独配 ts 运行器。无热重载（改数据层重启即可）。

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// 把 embeddedServer 打成内存 CJS 再执行其 start()。
const result = await build({
  entryPoints: [resolve(root, "src/server/embeddedServer.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  write: false,
  logLevel: "warning",
});

const code = result.outputFiles[0].text;
const req = createRequire(import.meta.url);
const module = { exports: {} };
const fn = new Function("require", "module", "exports", "__dirname", code);
fn(req, module, module.exports, resolve(root, "src/server"));

// embeddedServer 导出 start()
const mod = module.exports;
if (typeof mod.start === "function") {
  mod.start();
  console.log("[gold] dev node http 服务已起：http://127.0.0.1:3100  (Ctrl+C 退出)");
} else {
  console.error("[gold] embeddedServer 未导出 start()，请检查 src/server/embeddedServer.ts");
  process.exit(1);
}
