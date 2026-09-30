#!/usr/bin/env bash
# X11 会话下把站点压到桌面层：起一个 kiosk 浏览器窗口，再用 wmctrl 给它加
# "below" 状态 —— 这一步才是「壁纸」，否则它只是铺满屏的普通窗口。
#
#   bash desktop/linux/desktop-x11.sh                       # 用仓库里的单文件构建
#   bash desktop/linux/desktop-x11.sh https://xxx.github.io/spacetime-gravity-well/
#
# Wayland 会话没有把窗口压到桌面层的公开 API，脚本会直接拒绝并提示切 Xorg。
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
url="${1:-file://$repo/desktop/web/index.html}"

if [ ! -d "$repo/desktop/web" ] && [[ "$url" == file://* ]]; then
  echo "! 还没有单文件构建，先跑: npm run build:desktop" >&2
  exit 1
fi

browser="$(command -v google-chrome-stable || command -v google-chrome ||
           command -v chromium-browser || command -v chromium ||
           command -v microsoft-edge || true)"
[ -n "$browser" ] || { echo "! 需要 Chrome / Chromium / Edge" >&2; exit 1; }
command -v wmctrl >/dev/null || { echo "! 需要 wmctrl: sudo apt install wmctrl" >&2; exit 1; }

if [ "${XDG_SESSION_TYPE:-x11}" = "wayland" ]; then
  echo "! 当前是 Wayland 会话：没有把窗口压到桌面层的 API。" >&2
  echo "  注销后在登录界面右下角选「Ubuntu on Xorg」再登录，然后重跑本脚本。" >&2
  exit 1
fi

# 独立 profile：不与日常浏览器共用实例，退出即清理
profile="$(mktemp -d /tmp/gravity-well-desktop.XXXXXX)"
"$browser" --user-data-dir="$profile" --no-first-run --no-default-browser-check \
  --disable-session-crashed-bubble --kiosk "$url" >/dev/null 2>&1 &
pid=$!

# 等窗口出现再压层；Chromium 冷启动慢，最多等 20 秒
for _ in $(seq 1 40); do
  win="$(wmctrl -lp 2>/dev/null | awk -v p="$pid" '$3 == p {print $1; exit}')"
  [ -n "${win:-}" ] && break
  sleep 0.5
done

if [ -z "${win:-}" ]; then
  echo "! 没找到浏览器窗口（$pid），可能启动失败；日志目录 $profile" >&2
  exit 1
fi

wmctrl -i -r "$win" -b add,below
echo "✓ 已压到桌面层 (window=$win pid=$pid)"
echo "  恢复：kill $pid"
