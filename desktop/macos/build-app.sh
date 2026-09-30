#!/usr/bin/env bash
# 组装 .app：编译 Swift 壳 + 把单文件站点放进 Resources/web + ad-hoc 签名。
# 只依赖 Xcode Command Line Tools（swiftc / codesign），不需要 Xcode 工程。
#
#   bash desktop/macos/build-app.sh          # 产物在 desktop/macos/build/
#   OUT=/some/dir bash desktop/macos/build-app.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
final="${OUT:-$here/build}"
web="${WEB:-$repo/desktop/web}"
app_name="Gravity Well Desktop"

if [ ! -f "$web/index.html" ]; then
  echo "! 找不到单文件构建 $web/index.html —— 先跑: npm run build:desktop" >&2
  exit 1
fi

# 必须在非 iCloud 目录里签名：仓库在 ~/Documents 下时，iCloud 会给 bundle 目录
# 加 com.apple.FinderInfo / fileprovider 扩展属性，codesign 直接报
# "resource fork, Finder information, or similar detritus not allowed"。
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
app="$work/$app_name.app"

mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$here/Info.plist" "$app/Contents/Info.plist"
printf 'APPL????' >"$app/Contents/PkgInfo"
mkdir -p "$app/Contents/Resources/web"
cp "$web/index.html" "$app/Contents/Resources/web/index.html"

bin="$app/Contents/MacOS/GravityWellDesktop"
swiftc -O -target "$(uname -m)-apple-macos12.0" \
  -framework Cocoa -framework WebKit \
  -o "$bin" "$here/Sources/main.swift"

# 尽力而为补一份对方架构的 slice，让同一个 .app 能在 Apple Silicon / Intel 之间互传；
# 交叉编译失败不算错误，退化为单架构。
other="$( [ "$(uname -m)" = arm64 ] && echo x86_64 || echo arm64 )"
if swiftc -O -target "$other-apple-macos12.0" \
  -framework Cocoa -framework WebKit \
  -o "$bin.other" "$here/Sources/main.swift" 2>/dev/null; then
  lipo -create "$bin" "$bin.other" -output "$bin.universal"
  mv "$bin.universal" "$bin"
fi
rm -f "$bin.other"

# WKWebView 要求合法的 bundle 结构 + 签名；本地使用 ad-hoc 足够
codesign --force --sign - --timestamp=none "$app" >/dev/null
codesign --verify --verbose=1 "$app" 2>&1 | tail -1

mkdir -p "$final"
# rsync 不带 -X/-E，不会把扩展属性带进 iCloud 目录
rsync -a --delete "$app/" "$final/$app_name.app/"
echo "✓ $final/$app_name.app"
