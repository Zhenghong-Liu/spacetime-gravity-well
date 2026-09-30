import Cocoa
import WebKit

/*
 * 把构建产物变成 macOS 桌面层壁纸。
 *
 * 两个关键点：
 *  1) 无服务器。站点在构建时被内联成一个单文件 HTML（npm run build:desktop，
 *     见 vite.config.ts），随 .app 一起分发，运行时用官方 loadFileURL 读盘。
 *     必须内联：WebKit 不允许在 file:// 或自定义 scheme 上跨源加载 ES module，
 *     多文件产物会静默不执行（页面框架在、React 不跑）。
 *  2) 桌面层。普通窗口层级会被 Finder 的桌面图标盖住或被 Mission Control
 *     列出来，所以窗口层级取 CGWindowLevelForKey(.desktopIconWindow) + 1：
 *     盖住桌面图片和图标、但仍在 Dock 之下，这样控制台能吃鼠标事件（可拖拽
 *     旋转引力井）。ambient 层级则回到图片之上、图标之下并开启点击穿透，
 *     让桌面图标重新可用 —— 菜单栏里可切换。
 */

// MARK: - 配置

enum Key {
    static let interactive = "interactive"
    static let pageURL = "pageURL"
    static let loginItemTouched = "loginItemTouched"
}

/// 随 app 分发的单文件构建产物：Contents/Resources/web/index.html
let bundledPage = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")

/// 默认加载内置产物；想改指向 dev server 或线上地址：
///   defaults write com.liuzh.gravity-well-desktop pageURL -string "http://127.0.0.1:5173/"
var pageURL: URL? {
    if let custom = UserDefaults.standard.string(forKey: Key.pageURL),
       let url = URL(string: custom) {
        return url
    }
    return bundledPage
}

var isInteractive: Bool {
    get { UserDefaults.standard.object(forKey: Key.interactive) as? Bool ?? true }
    set { UserDefaults.standard.set(newValue, forKey: Key.interactive) }
}

/// 设计稿的画布留边色 --bg-canvas (#dce1d5)，菜单栏下方那条边用它补
let canvas = NSColor(srgbRed: 220.0 / 255, green: 225.0 / 255, blue: 213.0 / 255, alpha: 1)

extension WKWebView {
    /// file:// 必须走 loadFileURL，普通 load(_:) 会被 WebKit 的安全策略拒掉
    func loadWebPage() {
        guard let url = pageURL else {
            log("no bundled build under \(Bundle.main.resourceURL?.path ?? "?")/web — rerun install-macos.sh")
            return
        }
        if url.isFileURL {
            loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            load(URLRequest(url: url))
        }
    }
}

let logURL = FileManager.default
    .urls(for: .applicationSupportDirectory, in: .userDomainMask)
    .first?
    .appendingPathComponent("Gravity Well Desktop/last-load.log")

func log(_ message: String) {
    guard let url = logURL else { return }
    try? FileManager.default.createDirectory(
        at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let line = "\(Date()): \(message)\n"
    if let handle = try? FileHandle(forWritingTo: url) {
        defer { try? handle.close() }
        handle.seekToEndOfFile()
        handle.write(line.data(using: .utf8)!)
    } else {
        try? line.data(using: .utf8)?.write(to: url)
    }
}

// MARK: - 桌面层窗口

final class DesktopWindow: NSWindow {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class DesktopWebView: WKWebView {
    /// 桌面窗口不是激活应用，第一次点击默认只会被系统用来激活而吞掉；
    /// 返回 true 才能让「点一下桌面」直接进入网页的 pointerdown。
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var acceptsFirstResponder: Bool { true }
}

final class WallpaperController: NSObject, WKNavigationDelegate {
    private var windows: [DesktopWindow] = []
    private var webViews: [DesktopWebView] = []
    private var retry: Timer?

    var currentLevel: NSWindow.Level {
        isInteractive
            ? NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
            : NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 1)
    }

    func build() {
        teardown()
        for screen in NSScreen.screens { install(screen) }
        log("built \(windows.count) window(s) url=\(pageURL?.absoluteString ?? "nil") level=\(currentLevel.rawValue)")
    }

    /// 层级或点击穿透属性变化时只改现有窗口，不重建 WebView（重建会丢渲染状态）
    func apply(mode: Bool) {
        isInteractive = mode
        for window in windows {
            window.level = currentLevel
            window.ignoresMouseEvents = !mode
        }
    }

    func reload() {
        for webView in webViews { webView.reload() }
    }

    func reloadAll() {
        for webView in webViews { webView.loadWebPage() }
    }

    private func teardown() {
        for window in windows {
            window.orderOut(nil)
            window.close()
        }
        windows.removeAll()
        webViews.removeAll()
    }

    private func install(_ screen: NSScreen) {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // 菜单栏永远盖在最上层，壁纸窗口铺满整屏时页面顶部标题会被切一半。
        // 让 WebView 从菜单栏下沿开始铺，露出的那一条用画布留边色（--bg-canvas）
        // 补上 —— 正好是设计稿本来就有的画布边，看起来像有意为之。
        let menuBarHeight = max(0, screen.frame.maxY - screen.visibleFrame.maxY)
        let page = NSRect(x: 0, y: 0,
                          width: screen.frame.width,
                          height: screen.frame.height - menuBarHeight)

        let webView = DesktopWebView(frame: page, configuration: configuration)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.underPageBackgroundColor = canvas
        webView.loadWebPage()

        let window = DesktopWindow(contentRect: screen.frame,
                                   styleMask: [.borderless],
                                   backing: .buffered,
                                   defer: false)
        let container = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
        container.autoresizingMask = [.width, .height]
        container.wantsLayer = true
        container.layer?.backgroundColor = canvas.cgColor
        container.addSubview(webView)
        window.contentView = container
        window.level = currentLevel
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        window.ignoresMouseEvents = !isInteractive
        window.isOpaque = true
        window.backgroundColor = canvas
        window.hasShadow = false
        window.isRestorable = false
        window.isMovable = false
        window.animationBehavior = .none
        window.isExcludedFromWindowsMenu = true
        window.setFrame(screen.frame, display: true)
        window.orderFrontRegardless()

        windows.append(window)
        webViews.append(webView)
    }

    // MARK: WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retry?.invalidate()
        retry = nil
        // 用 canvas 是否存在判断 three.js 真的起来了，而不只是 HTML 加载完。
        // React 19 的挂载发生在 didFinish 之后，所以延迟一拍再查，别误报 0。
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak webView] in
            guard let webView else { return }
            webView.evaluateJavaScript(
                "[document.querySelectorAll('canvas').length, document.querySelectorAll('.app').length]"
            ) { result, error in
                log("loaded canvases/panels=\(result.map { "\($0)".replacingOccurrences(of: "\n", with: " ") } ?? "nil") error=\(error.map { "\($0)" } ?? "nil")")
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        scheduleRetry(reason: "didFail \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView,
                 didFailProvisionalNavigation navigation: WKNavigation!,
                 withError error: Error) {
        scheduleRetry(reason: "provisional \(error.localizedDescription)")
    }

    /// 加载失败多半是内置 web/ 还没构建或被移走；保持每 5 秒自愈，别退出
    private func scheduleRetry(reason: String) {
        log(reason)
        guard retry == nil else { return }
        retry = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
            self?.retry = nil
            self?.reloadAll()
        }
    }
}

// MARK: - 登录自启

enum LoginItem {
    static let bundleID = "com.liuzh.gravity-well-desktop"

    static var plistURL: URL {
        FileManager.default.urls(for: .libraryDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("LaunchAgents/\(bundleID).plist")
    }

    static var isRegistered: Bool {
        FileManager.default.fileExists(atPath: plistURL.path)
    }

    /// 手写 LaunchAgent 而不是 SMAppService：后者对 ad-hoc 签名的 app 行为不稳定，
    /// 而这个 plist 正是 SMAppService 底层落地的东西，直接写更可控、卸载也干净。
    @discardableResult
    static func register(executable: String) -> Bool {
        let body: [String: Any] = [
            "Label": bundleID,
            "ProgramArguments": [executable],
            "RunAtLoad": true,
            // 崩了要拉起来；用户从菜单栏主动 Quit 是正常退出，不复活
            "KeepAlive": ["SuccessfulExit": false],
        ]
        do {
            try FileManager.default.createDirectory(at: plistURL.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try PropertyListSerialization.data(fromPropertyList: body, format: .xml, options: 0)
                .write(to: plistURL)
        } catch {
            log("login item write failed: \(error.localizedDescription)")
            return false
        }
        // 可能已经注册过（重装场景），先卸再装
        launchctl(["bootout", "gui/\(getuid())/\(bundleID)"])
        let ok = launchctl(["bootstrap", "gui/\(getuid())", plistURL.path]) == 0
        log("login item registered=\(ok) exec=\(executable)")
        return ok
    }

    static func unregister() {
        launchctl(["bootout", "gui/\(getuid())/\(bundleID)"])
        try? FileManager.default.removeItem(at: plistURL)
        log("login item unregistered")
    }

    @discardableResult
    private static func launchctl(_ args: [String]) -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        process.arguments = args
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
        return process.terminationStatus
    }
}

/// 从「下载」目录或挂载的磁盘映像里首次启动时，把自己搬到 ~/Applications 并从新位置
/// 重启 —— 用户只需要双击一次，不用知道「拖进应用程序文件夹」这个仪式。
/// 返回 true 表示进程即将退出，调用方不要再继续。
func relocateToApplicationsIfNeeded() -> Bool {
    let current = Bundle.main.bundleURL.standardizedFileURL
    let home = NSHomeDirectory()
    guard current.path.hasPrefix("\(home)/Downloads") || current.path.hasPrefix("/Volumes/") else {
        return false
    }

    let dest = URL(fileURLWithPath: "\(home)/Applications")
        .appendingPathComponent(current.lastPathComponent)
    do {
        try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        if FileManager.default.fileExists(atPath: dest.path) {
            try FileManager.default.removeItem(at: dest)
        }
        try FileManager.default.copyItem(at: current, to: dest)
    } catch {
        log("relocate to \(dest.path) failed: \(error.localizedDescription)")
        return false
    }

    // 拷贝会带上浏览器打的 quarantine 标记，不清掉的话新位置首次启动会被 Gatekeeper 拦
    let xattr = Process()
    xattr.executableURL = URL(fileURLWithPath: "/usr/bin/xattr")
    xattr.arguments = ["-dr", "com.apple.quarantine", dest.path]
    xattr.standardError = FileHandle.nullDevice
    try? xattr.run()
    xattr.waitUntilExit()

    let exec = dest.appendingPathComponent("Contents/MacOS/GravityWellDesktop").path
    guard LoginItem.register(executable: exec) else {
        log("relocated but could not start the copy at \(exec)")
        return false
    }
    log("relocated \(current.path) → \(dest.path), relaunching from there")
    NSApp.terminate(nil)
    return true
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let wallpaper = WallpaperController()
    private var statusItem: NSStatusItem?
    private var interactiveItem: NSMenuItem?
    private var loginItem: NSMenuItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)

        guard isOnlyInstance() else { return }
        if relocateToApplicationsIfNeeded() { return }

        wallpaper.build()
        registerLoginItemOnFirstRun()
        installStatusItem()

        let center = NSWorkspace.shared.notificationCenter
        center.addObserver(self, selector: #selector(rebuild),
                           name: NSWorkspace.didWakeNotification, object: nil)
        center.addObserver(self, selector: #selector(rebuild),
                           name: NSWorkspace.screensDidWakeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(rebuild),
                                               name: NSApplication.didChangeScreenParametersNotification,
                                               object: nil)
    }

    /// 两份实例会叠出两层壁纸（搬迁/自启/手动双击都可能撞上），只留第一个
    private func isOnlyInstance() -> Bool {
        let mine = ProcessInfo.processInfo.processIdentifier
        let others = NSWorkspace.shared.runningApplications.filter {
            $0.bundleIdentifier == LoginItem.bundleID && $0.processIdentifier != mine
        }
        guard let other = others.first else { return true }
        log("instance \(other.processIdentifier) already owns the desktop; exiting")
        NSApp.terminate(nil)
        return false
    }

    /// 首次运行就把自己挂进登录项，这就是 release 里「双击一次」的那一步。
    /// 用户之后在菜单栏关掉的，就不再自作主张装回去。
    private func registerLoginItemOnFirstRun() {
        let touched = UserDefaults.standard.bool(forKey: Key.loginItemTouched)
        guard !touched, !LoginItem.isRegistered, let exec = Bundle.main.executablePath else { return }
        LoginItem.register(executable: exec)
    }

    @objc private func rebuild() {
        wallpaper.build()
    }

    private func installStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.image = NSImage(systemSymbolName: "camera.aperture",
                                     accessibilityDescription: "Gravity Well Desktop")
        let menu = NSMenu()

        let header = NSMenuItem(title: "Gravity Well Desktop", action: nil, keyEquivalent: "")
        header.isEnabled = false
        menu.addItem(header)
        menu.addItem(.separator())

        let reload = NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self
        menu.addItem(reload)

        let toggle = NSMenuItem(title: "Interactive Console", action: #selector(toggleInteractive),
                                keyEquivalent: "i")
        toggle.target = self
        toggle.state = isInteractive ? .on : .off
        toggle.toolTip = "关闭后回到桌面图标层，鼠标点击穿透给桌面"
        menu.addItem(toggle)
        interactiveItem = toggle

        let login = NSMenuItem(title: "Launch at Login", action: #selector(toggleLoginItem(_:)),
                               keyEquivalent: "")
        login.target = self
        login.state = LoginItem.isRegistered ? .on : .off
        menu.addItem(login)
        loginItem = login

        menu.addItem(.separator())
        let quit = NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)),
                              keyEquivalent: "q")
        quit.target = NSApp
        menu.addItem(quit)
        item.menu = menu
        statusItem = item
    }

    @objc private func reloadPage() {
        wallpaper.reload()
    }

    @objc private func toggleInteractive() {
        let next = !(interactiveItem?.state == .on)
        interactiveItem?.state = next ? .on : .off
        wallpaper.apply(mode: next)
    }

    @objc private func toggleLoginItem(_ sender: NSMenuItem) {
        UserDefaults.standard.set(true, forKey: Key.loginItemTouched)
        if sender.state == .on {
            LoginItem.unregister()
        } else if let exec = Bundle.main.executablePath {
            LoginItem.register(executable: exec)
        }
        sender.state = LoginItem.isRegistered ? .on : .off
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
