#!/usr/bin/env bash
# 产出 GitHub Release 的附件（全部离线可用，装完不需要网络）：
#   GravityWellDesktop-<ver>-macOS.zip   预构建 .app + 安装说明 + 卸载脚本，双击即用
#   GravityWellDesktop-<ver>.html        单文件站点，给 Windows Lively / Linux kiosk 用
#
#   bash desktop/macos/make-release.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
out="$repo/desktop/release"
name="Gravity Well Desktop"

version="$(node -p "require('$repo/package.json').version")"
stage="$out/stage"

echo "· 构建单文件站点"
cd "$repo"
npm run build:desktop

echo "· 打包 app"
OUT="$out/app-build" bash "$here/build-app.sh"

rm -rf "$stage"
mkdir -p "$stage"
rsync -a "$out/app-build/$name.app/" "$stage/$name.app/"
# 附件里这份是最终交付物，签名字段随拷贝走，落位后再签一次最稳
codesign --force --sign - --timestamp=none "$stage/$name.app" >/dev/null

cat >"$stage/安装说明.txt" <<'EOF'
Gravity Well Desktop —— 把引力井控制台变成 macOS 桌面壁纸

1. 把 "Gravity Well Desktop.app" 双击打开。
   首次打开 macOS 会提示「无法验证开发者」：对着它点右键 → 打开 → 再点「打开」，
   只有第一次需要这么点。之后它会把自己搬到 ~/Applications 并加入登录项，
   以后开机自动生效。
2. 打开后整个桌面就是这套控制台。桌面上按住拖动 = 旋转引力井，滚轮 = 缩放。
   代价是桌面图标被盖住：菜单栏的小光圈图标 → Interactive Console 关掉，
   就退回「桌面图标可用 + 鼠标点击穿透」的纯展示层。
3. 菜单栏小光圈图标：Reload 重载、Launch at Login 开关登录自启、Quit 退出。
4. 卸载：双击同目录下的「卸载.command」。

说明：这是完全离线的 —— 站点在构建时被内联成单个 HTML 打进 .app，运行时不联网、
不起服务、不占端口。app 是 ad-hoc 签名（没有花 $99 买 Developer ID 和公证），
所以首次打开需要上面那一步右键确认；不放心也可以自己 clone 仓库跑
`bash desktop/install-macos.sh` 从源码构建。

日志：~/Library/Application Support/Gravity Well Desktop/last-load.log
EOF

cat >"$stage/卸载.command" <<'EOF'
#!/bin/bash
# 撤销 Gravity Well Desktop 的全部改动
id=gui/$(id -u)/com.liuzh.gravity-well-desktop
/bin/launchctl bootout "$id" 2>/dev/null
/usr/bin/pkill -x GravityWellDesktop 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/com.liuzh.gravity-well-desktop.plist"
rm -rf "$HOME/Applications/Gravity Well Desktop.app"
rm -rf "$HOME/Library/Application Support/Gravity Well Desktop"
/usr/bin/defaults delete com.liuzh.gravity-well-desktop 2>/dev/null
echo "已卸载，桌面恢复系统壁纸。可以关掉这个窗口了。"
EOF
chmod +x "$stage/卸载.command"

rm -f "$out/GravityWellDesktop-$version-macOS.zip"
(cd "$stage" && zip -qry "$out/GravityWellDesktop-$version-macOS.zip" ".")
cp "$repo/desktop/web/index.html" "$out/GravityWellDesktop-$version.html"
rm -rf "$stage" "$out/app-build"

echo
echo "✓ $out/GravityWellDesktop-$version-macOS.zip ($(du -h "$out/GravityWellDesktop-$version-macOS.zip" | cut -f1 | tr -d ' '))"
echo "✓ $out/GravityWellDesktop-$version.html ($(du -h "$out/GravityWellDesktop-$version.html" | cut -f1 | tr -d ' '))"
echo
echo "发 Release："
echo "  gh release create v$version $out/GravityWellDesktop-$version-macOS.zip $out/GravityWellDesktop-$version.html --title 'v$version' --notes-file <notes>"
