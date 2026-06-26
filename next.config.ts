import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// 把文件追踪根固定到 PhoneApp 自身目录。
// 否则 Next 会因为主项目根也有 package-lock.json 而把工作区根推断到上层目录，
// 既产生警告，也违反「与主项目隔离」的约束。这里强制只以 PhoneApp 为根。
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: projectRoot,
};

export default nextConfig;
