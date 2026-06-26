#!/data/data/com.termux/files/usr/bin/bash
# 黄金看板·手机版 一键启动脚本（Termux / 安卓）
# 用法：在 gold-phone-app 目录下执行  ./run.sh
# 作用：拉最新代码 → 按需装依赖 → 构建 → 启动本机服务(端口 3100)
# 全程本机运行，不依赖任何外部服务器。

set -e
cd "$(dirname "$0")"

PORT="${PORT:-3100}"

echo "==> [1/4] 拉取最新代码 (git pull)"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git pull --ff-only || echo "    (git pull 跳过/失败，使用本地现有代码继续)"
else
  echo "    (非 git 目录，跳过 pull)"
fi

# 仅当 node_modules 缺失，或 lockfile 比已装依赖更新时才重装，省时间
echo "==> [2/4] 检查依赖"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "    安装依赖中（首次较慢，请耐心等待）..."
  npm install
else
  echo "    依赖已是最新，跳过 npm install"
fi

echo "==> [3/4] 构建生产版本 (npm run build)"
npm run build

echo "==> [4/4] 启动服务：http://localhost:${PORT}"
echo "    手机浏览器打开上面地址即可；Ctrl+C 停止。"
exec npx next start -p "${PORT}"
