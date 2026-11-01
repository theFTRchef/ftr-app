import SwiftUI
import WebKit

/// Chef's Kitchen: your real admin page (the same one you use on the web),
/// opened inside the app and already signed in. Because it IS the admin page,
/// every menu item, setting, date and order is the same data the WhatsApp bot
/// uses - nothing to keep in sync, and new admin features show up here too.
struct KitchenView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var url: URL?
    @State private var error: String?
    @State private var loading = true
    @State private var reloadToken = 0

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.bg.ignoresSafeArea()
                if let url {
                    AdminWebView(url: url, loading: $loading, reloadToken: reloadToken)
                        .ignoresSafeArea(edges: .bottom)
                } else if let error {
                    VStack(spacing: 14) {
                        Notice(tone: .bad, icon: "exclamationmark.circle", text: error)
                        Button("Try again") { Task { await open() } }.buttonStyle(SecondaryButtonStyle()).frame(maxWidth: 220)
                    }
                    .padding(24)
                }
                if loading && error == nil { ProgressView().tint(Palette.leaf) }
            }
            .navigationTitle("Chef's Kitchen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { reloadToken += 1 } label: { Image(systemName: "arrow.clockwise") }
                        .accessibilityLabel("Reload")
                        .disabled(url == nil)
                }
            }
            .task { await open() }
        }
    }

    /// Ask the server for a one-time link that signs this phone in to the admin page.
    private func open() async {
        struct R: Decodable { let path: String }
        struct B: Encodable {}
        error = nil
        loading = true
        do {
            let r: R = try await APIClient.shared.post("admin/handoff", B())
            url = APIClient.shared.absolute(r.path)
        } catch {
            loading = false
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}

/// WKWebView for the admin page: keeps its sign-in cookie, lets you upload the
/// Zelle QR from Photos, saves "Excel" downloads through the share sheet, and
/// opens WhatsApp / phone links in their own apps.
struct AdminWebView: UIViewRepresentable {
    let url: URL
    @Binding var loading: Bool
    let reloadToken: Int

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // the 30-day admin sign-in survives app restarts
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.uiDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false
        web.backgroundColor = UIColor(Palette.bg)
        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pulled(_:)), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        web.load(URLRequest(url: url))
        context.coordinator.lastReload = reloadToken
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.lastReload != reloadToken {
            context.coordinator.lastReload = reloadToken
            web.reload()
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        var parent: AdminWebView
        var lastReload = 0
        private var downloadURL: URL?

        init(_ parent: AdminWebView) { self.parent = parent }

        @objc func pulled(_ sender: UIRefreshControl) {
            (sender.superview?.superview as? WKWebView)?.reload()
            sender.endRefreshing()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { parent.loading = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loading = false }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { parent.loading = false }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { parent.loading = false }

        /// Stay on your own server; WhatsApp, phone and other sites open in their apps.
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url else { return decisionHandler(.cancel) }
            if navigationAction.shouldPerformDownload { return decisionHandler(.download) }
            let ownHost = parent.url.host
            if target.scheme == "about" || target.scheme == "blob" || target.scheme == "data" || target.host == ownHost {
                return decisionHandler(.allow)
            }
            UIApplication.shared.open(target)
            decisionHandler(.cancel)
        }

        /// "Orders for Excel" / "Customers for Excel" come back as file downloads.
        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            let disposition = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
            if disposition.lowercased().contains("attachment") || !navigationResponse.canShowMIMEType {
                return decisionHandler(.download)
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
        func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

        func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent(suggestedFilename)
            try? FileManager.default.removeItem(at: dest)
            downloadURL = dest
            completionHandler(dest)
        }

        func downloadDidFinish(_ download: WKDownload) {
            guard let file = downloadURL else { return }
            let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            Self.topController()?.present(share, animated: true)
        }

        func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
            downloadURL = nil
        }

        /// Links that open a new window (e.g. "WhatsApp" on an order) go to their app.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let target = navigationAction.request.url {
                if target.host == parent.url.host { webView.load(navigationAction.request) } else { UIApplication.shared.open(target) }
            }
            return nil
        }

        private static func topController() -> UIViewController? {
            let root = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow)?.rootViewController
            var top = root
            while let next = top?.presentedViewController { top = next }
            return top
        }
    }
}
