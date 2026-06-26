#!/data/data/com.termux/files/usr/bin/bash
# 黄金看板·手机版 一键启动脚本（Termux / 安卓）
# 用法：在 gold-phone-app 目录下执行  ./run.sh
# 作用：拉最新代码 → 按需装依赖 → 按需构建 → 启动本机服务(端口 3100)
# 全程本机运行，不依赖任何外部服务器。
# 升级用法：./run.sh         （会自动 git pull 到最新，再按需重装/重构建）

set -e
cd "$(dirname "$0")"

PORT="${PORT:-3100}"

# ---- [1/4] 拉取最新代码 ----
echo "==> [1/4] 拉取最新代码 (git pull)"
HEAD_BEFORE=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  HEAD_BEFORE="$(git rev-parse HEAD 2>/dev/null || true)"
  git pull --ff-only || echo "    (git pull 跳过/失败，使用本地现有代码继续)"
  HEAD_AFTER="$(git rev-parse HEAD 2>/dev/null || true)"
else
  echo "    (非 git 目录，跳过 pull)"
fi

# ---- [2/4] 按需装依赖（node_modules 缺失，或 lockfile 比它新）----
echo "==> [2/4] 检查依赖"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "    安装依赖中（首次较慢，请耐心等待）..."
  npm install
else
  echo "    依赖已是最新，跳过 npm install"
fi

# ---- [3/4] 按需构建（无构建产物，或代码有更新时才重建，平时秒启）----
echo "==> [3/4] 检查构建"
NEED_BUILD=0
if [ ! -d .next ]; then
  NEED_BUILD=1                                   # 从没构建过
elif [ -n "$HEAD_BEFORE" ] && [ "$HEAD_BEFORE" != "$HEAD_AFTER" ]; then
  NEED_BUILD=1                                   # 这次 pull 拉到了新代码
fi
if [ "$NEED_BUILD" = "1" ]; then
  echo "    构建生产版本 (npm run build)..."
  npm run build
else
  echo "    无代码变更，跳过构建"
fi

# ---- [4/4] 启动 ----
echo "==> [4/4] 启动服务：http://localhost:${PORT}"
echo "    手机浏览器打开上面地址即可；Ctrl+C 停止。"
exec npx next start -p "${PORT}"
