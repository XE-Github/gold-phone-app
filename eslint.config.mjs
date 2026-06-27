import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // 内嵌 Node 打包产物（生成物，源在 src/server+src/lib）
      "public/nodejs-project/main.js",
      // Capacitor 生成的原生工程（含大量第三方/生成代码）
      "android/**",
      // 构建脚本（Node 工具，非应用代码；CJS 执行需要 module 变量）
      "scripts/**",
    ],
  },
];

export default eslintConfig;
