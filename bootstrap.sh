#!/data/data/com.termux/files/usr/bin/bash
# 黄金看板·手机版 —— 从零一键引导脚本（Termux / 安卓）
# ============================================================
# 在 Termux 里粘贴下面这一行即可（无需先 clone）：
#
#   curl -fsSL https://raw.githubusercontent.com/XE-Github/gold-phone-app/main/bootstrap.sh | bash
#
# 它会自动：安装 Node/git → 克隆公开仓库 → 装依赖 → 构建 → 启动 → 打开 http://localhost:3100
# 再次运行同一行 = 升级到最新（已存在则 git pull）。
# 全程本机运行，不依赖任何外部服务器（抓金价时需手机联网）。
# ============================================================

set -e

REPO_URL="https://github.com/XE-Github/gold-phone-app.git"
APP_DIR="$HOME/gold-phone-app"
PORT="${PORT:-3100}"

say() { echo ""; echo "==== $* ===="; }

# ---- 0) 必须在 Termux 里跑 ----
if [ ! -d /data/data/com.termux ]; then
  echo "⚠️  这个脚本是给安卓 Termux 用的。请在 Termux App 里运行。"
  echo "    Termux 请从 F-Droid 安装：https://f-droid.org/packages/com.termux/"
  exit 1
fi

# ---- 1) 安装运行环境（幂等：已装会跳过）----
say "[1/5] 安装运行环境 (nodejs-lts / git)"
yes | pkg update -y >/dev/null 2>&1 || true
pkg install -y nodejs-lts git >/dev/null 2>&1 || pkg install -y nodejs git
echo "    node $(node -v 2>/dev/null) / npm $(npm -v 2>/dev/null) / $(git --version 2>/dev/null)"

# ---- 2) 克隆或更新代码 ----
if [ -d "$APP_DIR/.git" ]; then
  say "[2/5] 已存在，拉取最新代码"
  cd "$APP_DIR"
  git pull --ff-only || echo "    (pull 失败，用本地现有代码继续)"
else
  say "[2/5] 克隆代码到 $APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ---- 3) 修脚本换行（防 Windows CRLF 导致 bad interpreter）----
say "[3/5] 规范化脚本"
sed -i 's/\r$//' run.sh bootstrap.sh 2>/dev/null || true
chmod +x run.sh bootstrap.sh 2>/dev/null || true

# ---- 4) 交给 run.sh 完成 装依赖→构建→启动 ----
say "[4/5] 装依赖 / 构建 / 启动（首次较慢，请耐心等待）"
echo "    启动后手机浏览器打开： http://localhost:${PORT}"
echo "    （建议在该页面用浏览器菜单「添加到主屏幕」当 App 用）"

# ---- 5) run ----
say "[5/5] 启动服务"
exec env PORT="$PORT" bash ./run.sh
