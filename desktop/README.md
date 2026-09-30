# 当桌面壁纸

把这套引力井可视化挂在操作系统桌面上，三端都能做，但成熟度不一样：

| 系统 | 做法 | 离线 | 开机自启 | 桌面上可拖拽 |
| --- | --- | --- | --- | --- |
| macOS | 仓库自带的原生壳 `desktop/macos/` | ✅ 站点打进 .app | ✅ LaunchAgent | ✅（可切回穿透） |
| Windows | [Lively Wallpaper](https://github.com/rocksdanister/lively) 加载本地 HTML 或网址 | ✅ | ✅（Lively 自带） | 取决于 Lively 设置 |
| Ubuntu (X11) | `desktop/linux/desktop-x11.sh` 把 kiosk 浏览器压到桌面层 | ✅ | 手动加自启动项 | ❌ 纯展示 |
| Ubuntu (Wayland) | 做不到 —— 没有把窗口压到桌面层的公开 API | — | — | — |

三端共用同一个产物：**`desktop/web/index.html`**，由 `npm run build:desktop` 生成。
它把 JS/CSS 全部内联成单个 HTML，**不发任何外部请求**，所以：

- 不需要本地 HTTP 服务器，`file://` 直接打开就能跑；
- 之所以必须内联：WebKit / Chromium 都不允许在 `file://`（或自定义 scheme）上跨源
  加载 ES module，多文件产物会静默不执行 —— 页面框架在，React 不跑。

## 分发：Release 附件，不依赖网络

`bash desktop/macos/make-release.sh` 产出两个文件（`desktop/release/`，已 gitignore）：

| 附件 | 给谁 | 怎么用 |
| --- | --- | --- |
| `GravityWellDesktop-<ver>-macOS.zip` | macOS 用户 | 解压 → 双击 app（首次右键 → 打开）→ 完事 |
| `GravityWellDesktop-<ver>.html` | Windows / Linux / 想自己塞进别处的人 | 单文件，Lively 或 kiosk 浏览器直接指向它 |

zip 里那个 app 是**预构建 + 自带站点**的，装的人不需要 node、npm、Xcode，也不需要联网。
首次双击时它会自己搬到 `~/Applications`、自己写好登录项再从新位置起来，所以「一键配置」
真的就是一键；想撤就是同目录下的 `卸载.command`。


## macOS

普通用户下载 Release 里的 zip 双击就行（见上一节）。clone 仓库的人从源码装：

```bash
bash desktop/install-macos.sh        # 构建单文件站点 + 打包 .app + 装到 ~/Applications + 启动
bash desktop/uninstall-macos.sh      # 全部撤销，恢复系统壁纸
```

装完后菜单栏有一个光圈图标：**Reload** 重载页面，**Interactive Console** 在两种层级间切换，
**Launch at Login** 开关登录自启。

- 开（默认）：窗口在桌面图标层之上 → 桌面上可以直接拖拽旋转、滚轮缩放，代价是桌面图标被盖住。
- 关：窗口回到桌面图片之上、图标之下，并开启点击穿透 → 图标和点击全部还给桌面。

其他可调项：

```bash
# 指向 dev server 实时看改动（改完代码 kickstart 一下）
defaults write com.liuzh.gravity-well-desktop pageURL -string "http://127.0.0.1:5173/"
launchctl kickstart -k gui/$(id -u)/com.liuzh.gravity-well-desktop

# 恢复内置产物
defaults delete com.liuzh.gravity-well-desktop pageURL
```

只改了站点代码时：`npm run build:desktop && SKIP_BUILD=1 bash desktop/install-macos.sh`。

排查：`~/Library/Application Support/Gravity Well Desktop/last-load.log` 里每次加载会写一行
`loaded canvases/panels=( 2, 1 )`；两个数都是 0 说明页面没跑起来。窗口本身在不在桌面层，
可以用 `CGWindowListCopyWindowInfo` 看 layer（交互层 -2147483602，穿透层 -2147483622）。

实现只有 `desktop/macos/Sources/main.swift` 一个文件：`NSWindow` 设成
`CGWindowLevelForKey(.desktopIconWindow) + 1` + `collectionBehavior` 里给
`canJoinAllSpaces / stationary`，内容是一个 `loadFileURL` 的 `WKWebView`。
不需要 Xcode 工程，Command Line Tools 的 `swiftc` 就够；产物 ad-hoc 签名，只在本机用。

> 构建/签名有个坑：仓库放在 `~/Documents`（iCloud 同步）下时，Finder 会给 .app 目录加
> `com.apple.FinderInfo`，`codesign` 会直接报 *detritus not allowed*。`build-app.sh`
> 因此在 `$TMPDIR` 里组装并签名，再把 bundle rsync 出来。

## Windows

用现成的开源壁纸引擎，不需要自己写桌面层代码：

```powershell
winget install rocky.lively
```

打开 Lively → 「+」→ 把 `desktop\web\index.html` 拖进去（或粘贴线上地址）。
Lively 自己就是登录自启的，也可以在它设置里关掉「全屏应用时暂停」来省电。
Wallpaper Engine（付费）同理：新建 Project → 网页类型 → 指向同一个文件。

## Ubuntu

先 `npm run build:desktop` 产出 `desktop/web/index.html`，然后：

```bash
sudo apt install wmctrl
bash desktop/linux/desktop-x11.sh
# 或者指向线上地址：
bash desktop/linux/desktop-x11.sh https://<user>.github.io/spacetime-gravity-well/
```

脚本用 `wmctrl -b add,below` 把 Chrome/Chromium 的 kiosk 窗口压到桌面层。
Wayland（22.04 起的默认会话）做不到，注销后在登录界面选 **Ubuntu on Xorg**。
如果装了桌面图标扩展，图标会被这个窗口盖住 —— 和 macOS 的交互层一样。

## 可选：挂成一个网址

壁纸本身不依赖网络（macOS 走内置产物，Windows/Linux 可以指向本地 `index.html`）。
但如果想让别人连下载都不用，`npm run build` 出的 `dist/` 是纯静态的（资源路径是相对的），
丢到任何静态托管即可（GitHub Pages / Netlify / 一台 nginx）。有了网址之后，Windows 和
Ubuntu 就只是「在壁纸工具里填一个 URL」；macOS 的壳也支持：

```bash
defaults write com.liuzh.gravity-well-desktop pageURL -string "https://<user>.github.io/spacetime-gravity-well/"
launchctl kickstart -k gui/$(id -u)/com.liuzh.gravity-well-desktop
```
