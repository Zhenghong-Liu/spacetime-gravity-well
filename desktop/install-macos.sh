#!/usr/bin/env bash
# 从源码装 macOS 桌面壁纸（给 clone 仓库的人；普通用户走 Release 里的 zip，双击即可）。
#   构建单文件站点 → 打包 .app → 装到 ~/Applications → 启动
# 登录自启由 app 首次启动时自己注册（见 Sources/main.swift 的 registerLoginItemOnFirstRun）。
#
#   bash desktop/install-macos.sh
#   SKIP_BUILD=1 bash desktop/install-macos.sh      # 复用已有 desktop/web/
# 卸载：bash desktop/uninstall-macos.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/.." && pwd)"
bundle_id="com.liuzh.gravity-well-desktop"
app_name="Gravity Well Desktop"
dest="$HOME/Applications/$app_name.app"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "! 需要 Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

cd "$repo"
if [ "${SKIP_BUILD:-}" != "1" ]; then
  echo "· 构建单文件站点 desktop/web/index.html"
  [ -d node_modules ] || npm install
  npm run build:desktop
fi

echo "· 打包 app"
bash "$here/macos/build-app.sh"

echo "· 安装到 $dest"
mkdir -p "$HOME/Applications"
rsync -a --delete "$here/macos/build/$app_name.app/" "$dest/"
# 落位后再签一次：ad-hoc 签名按内容算，重签可以排除拷贝过程带来的干扰
codesign --force --sign - --timestamp=none "$dest" >/dev/null

echo "· 启动"
# 先退掉旧实例，否则 open 只会把已在运行的那份唤到前台，看不到新构建
pkill -x GravityWellDesktop 2>/dev/null || true
sleep 1
open "$dest"

cat <<EOF

✓ 已经挂到桌面上了（菜单栏有一个小光圈图标）。
  · 桌面上可以直接拖拽旋转、滚轮缩放 —— 代价是桌面图标被控制台盖住。
    想恢复图标和点击穿透：菜单栏图标 → Interactive Console 关掉。
  · 换壁纸内容 = 改代码后重跑本脚本；想临时看 dev server：
      defaults write $bundle_id pageURL -string "http://127.0.0.1:5173/"
      launchctl kickstart -k gui/$(id -u)/$bundle_id
  · 卸载：bash desktop/uninstall-macos.sh
EOF
