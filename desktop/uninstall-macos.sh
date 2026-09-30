#!/usr/bin/env bash
# 撤销 install-macos.sh 做的全部改动：停进程、删 LaunchAgent、删 app、清偏好。
set -uo pipefail

bundle_id="com.liuzh.gravity-well-desktop"
app_name="Gravity Well Desktop"
uid="$(id -u)"

launchctl bootout "gui/$uid/$bundle_id" 2>/dev/null || true
pkill -x GravityWellDesktop 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$bundle_id.plist"
rm -rf "$HOME/Applications/$app_name.app"
rm -rf "$HOME/Library/Application Support/$app_name"
defaults delete "$bundle_id" 2>/dev/null || true

echo "✓ 已卸载，桌面恢复成系统壁纸"
