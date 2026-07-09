#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("-"));
const allowDirty = args.includes("--allow-dirty");
const push = args.includes("--push");
const dryRun = args.includes("--dry-run");
const messageArg = valueAfter("--message") ?? valueAfter("-m");
const summary = messageArg ?? "本地一键发版";

if (!version || !/^\d+\.\d+\.\d+([+-][0-9A-Za-z.-]+)?$/.test(version)) {
  fail("用法：npm run release -- 0.1.23 [--message \"说明\"] [--push] [--allow-dirty] [--dry-run]");
}

const tag = `v${version}`;
const root = process.cwd();
const pkgPath = resolve(root, "package.json");
const lockPath = resolve(root, "package-lock.json");

function valueAfter(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function fail(message) {
  console.error(`\n[release] ${message}`);
  process.exit(1);
}

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n$ ${[cmd, ...cmdArgs].join(" ")}`);
  if (dryRun && opts.mutate) return "";
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
  const r = spawnSync(cmd, cmdArgs, { stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8", shell: needsShell });
  if (r.status !== 0) {
    const stderr = r.stderr ? `\n${r.stderr}` : "";
    fail(`命令失败：${cmd} ${cmdArgs.join(" ")}${stderr}`);
  }
  return r.stdout ?? "";
}

function git(args, opts = {}) {
  return run("git", args, opts);
}

function nodeBin(bin) {
  return process.platform === "win32" ? `${bin}.cmd` : bin;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

console.log(`[release] 准备发布 ${tag}`);

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { capture: true }).trim();
if (branch !== "main") fail(`当前分支是 ${branch}，请先切到 main`);

const existingTag = spawnSync("git", ["rev-parse", "--verify", tag], { stdio: "ignore", shell: false });
if (existingTag.status === 0) fail(`本地 tag 已存在：${tag}`);

const remoteTag = spawnSync("git", ["ls-remote", "--exit-code", "--tags", "origin", tag], { stdio: "ignore", shell: false });
if (remoteTag.status === 0) fail(`远端 tag 已存在：${tag}`);

const dirtyBefore = git(["status", "--short"], { capture: true }).trim();
if (dirtyBefore && !allowDirty) {
  console.log(dirtyBefore);
  fail("工作区不干净。请先提交/暂存/清理，或确认风险后加 --allow-dirty");
}

if (dirtyBefore && allowDirty) {
  console.log("[release] 警告：允许脏工作区继续。脚本只暂存 release 相关文件，但请自行确认不会混入无关改动。");
  console.log(dirtyBefore);
}

const pkg = readJson(pkgPath);
pkg.version = version;
if (!dryRun) writeJson(pkgPath, pkg);

const lock = readJson(lockPath);
lock.version = version;
if (lock.packages?.[""]) lock.packages[""].version = version;
if (!dryRun) writeJson(lockPath, lock);

run(nodeBin("npx"), ["tsc", "--noEmit"]);
run(nodeBin("npm"), ["run", "lint"]);
run(nodeBin("npm"), ["run", "build"]);
run(nodeBin("npm"), ["run", "bundle:node"]);
run(nodeBin("npx"), ["cap", "sync", "android"]);

const releaseFiles = [
  "package.json",
  "package-lock.json",
  "android/app/src/main/java/com/xegithub/goldphone/GoldForegroundService.java",
  "android/app/src/main/java/com/xegithub/goldphone/BackgroundDataPlugin.java",
  "src/components/BackgroundDataCard.tsx",
  "src/components/BankGoldCompare.tsx",
  "src/components/HeroPrice.tsx",
  "src/lib/backgroundData.ts",
  "src/lib/usePriceAlerts.ts",
  "src/lib/quotes.ts",
  "src/lib/sina.ts",
  "src/lib/goldApi.ts",
  "src/lib/eastmoney.ts",
  "src/lib/display.ts",
  "src/app/page.tsx",
  "scripts/release.mjs",
];

if (dryRun) {
  console.log("[release] dry-run 完成：版本文件未写入，未暂存/提交/tag/push");
  process.exit(0);
}

git(["add", ...releaseFiles], { mutate: true });

const staged = git(["diff", "--cached", "--name-only"], { capture: true }).trim();
if (!staged) fail("没有 staged 改动，取消发布");
console.log(`\n[release] staged files:\n${staged}`);

const commitMsg = `${tag}: ${summary}`;
git(["commit", "-m", commitMsg, "-m", "Co-Authored-By: Claude <noreply@anthropic.com>"], { mutate: true });
git(["tag", tag], { mutate: true });

if (push) {
  git(["push", "origin", "main"], { mutate: true });
  git(["push", "origin", tag], { mutate: true });
  console.log(`[release] 已推送 ${tag}，GitHub Actions 将构建 Release APK`);
} else {
  console.log(`[release] 已创建本地提交和 tag：${tag}`);
  console.log(`[release] 如需发布 APK，请运行：git push origin main && git push origin ${tag}`);
}
