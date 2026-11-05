// GameViewController.swift — full-screen WKWebView running the bundled game.
//
// Why a custom URL scheme: the game is built from ES modules, and WebKit will
// not load module scripts from file:// URLs (the origin is opaque, so the
// CORS check fails and the page just sits on its loading screen — the exact
// problem the Android build solved with appassets.androidplatform.net).
// Serving the bundle through app://game/ gives the page a real, stable
// origin, so modules, fetch() of the 3D model and localStorage all work.

import UIKit
import WebKit

final class GameViewController: UIViewController {
    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []  // engine audio starts on first tap
        config.preferences.javaScriptCanOpenWindowsAutomatically = false

        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        // a game, not a page: no scrolling, bouncing, zooming or link previews
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.allowsLinkPreview = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }   // Safari ▸ Develop
        #endif
        view = webView
    }

    private lazy var updater = Updater(host: self)

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: URL(string: "\(BundleSchemeHandler.scheme)://game/index.html")!))
        NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification,
                                               object: nil, queue: .main) { [weak self] _ in
            self?.updater.checkIfDue()
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // let the game finish booting before asking anything
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.updater.checkIfDue() }
    }

    // Edge-to-edge and out of the way: the thumbstick and buttons live right
    // against the screen edges, so defer the system swipe gestures there.
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }
}

/// Serves files from the bundled `game` folder at app://game/…
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    private let root: URL = Bundle.main.resourceURL!.appendingPathComponent("game", isDirectory: true)

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        let rootPath = root.standardizedFileURL.path
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        // never serve anything outside the game folder (no ../ escapes)
        guard file.path.hasPrefix(rootPath + "/"),
              let data = try? Data(contentsOf: file) else {
            let resp = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(resp)
            task.didReceive(Data("not found".utf8))
            task.didFinish()
            return
        }
        let headers = [
            "Content-Type": Self.mime(for: file.pathExtension.lowercased()),
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache"
        ]
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private static func mime(for ext: String) -> String {
        switch ext {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs":   return "text/javascript; charset=utf-8"
        case "css":         return "text/css; charset=utf-8"
        case "json":        return "application/json"
        case "webmanifest": return "application/manifest+json"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg":         return "image/svg+xml"
        case "glb":         return "model/gltf-binary"
        case "wasm":        return "application/wasm"
        default:            return "application/octet-stream"
        }
    }
}
