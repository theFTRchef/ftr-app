import AuthenticationServices
import CryptoKit
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
    /// Set when Chef's Kitchen needs Chef's Google account (see /admin/google/start).
    @State private var googleStart: URL?
    @State private var signedOut = false
    @State private var google = GoogleSignIn()

    var body: some View {
        NavigationStack {
            ZStack {
                Palette.bg.ignoresSafeArea()
                if signedOut {
                    VStack(spacing: 14) {
                        Notice(tone: .info, icon: "lock", text: "You're signed out of Chef's Kitchen.")
                        Button("Sign in with Google") { Task { await signInWithGoogle() } }
                            .buttonStyle(PrimaryButtonStyle()).frame(maxWidth: 260)
                    }
                    .padding(24)
                } else if let url {
                    AdminWebView(url: url, loading: $loading, reloadToken: reloadToken,
                                 needsSignIn: { out in
                                     if out { signedOut = true; loading = false } else { Task { await signInWithGoogle() } }
                                 })
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

    /// Ask the server how to open the admin page: with Chef's Google account (when
    /// it's set up), or with a one-time link for this signed-in phone.
    private func open() async {
        struct R: Decodable { let path: String?; let google: String? }
        struct B: Encodable { let google = true }
        error = nil
        signedOut = false
        loading = true
        do {
            let r: R = try await APIClient.shared.post("admin/handoff", B())
            if let g = r.google {
                googleStart = APIClient.shared.absolute(g)
                // A Google sign-in from the last 30 days is still in this app's web view;
                // if not, the admin page sends us to its login and we open Google.
                url = APIClient.shared.absolute("/admin")
            } else if let p = r.path {
                url = APIClient.shared.absolute(p)
            }
        } catch {
            loading = false
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    /// Google sign-in in Apple's secure sign-in sheet (Google doesn't allow it inside a web view).
    private func signInWithGoogle() async {
        guard let start = googleStart else { await open(); return }
        loading = true
        // A fresh secret for this sign-in; the server only sees its SHA-256 (cc) and
        // won't open Chef's Kitchen unless the same secret comes back with the code.
        var raw = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, raw.count, &raw)
        let verifier = Data(raw).base64URL
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var comps = URLComponents(url: start, resolvingAgainstBaseURL: false)
        comps?.queryItems = (comps?.queryItems ?? []).filter { $0.name != "cc" } + [URLQueryItem(name: "cc", value: challenge)]
        do {
            let callback = try await google.signIn(start: comps?.url ?? start)
            let code = URLComponents(url: callback, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "code" })?.value ?? ""
            signedOut = false
            error = nil
            var entry = URLComponents(string: "/admin/app-entry")
            entry?.queryItems = [URLQueryItem(name: "code", value: code), URLQueryItem(name: "v", value: verifier)]
            url = APIClient.shared.absolute(entry?.string)
        } catch let e as ASWebAuthenticationSessionError where e.code == .canceledLogin {
            loading = false
            signedOut = true
        } catch {
            loading = false
            self.error = "Couldn't sign in with Google. Please try again."
        }
    }
}

private extension Data {
    var base64URL: String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

/// Runs Google sign-in in ASWebAuthenticationSession and returns the ftrdose:// callback.
@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func signIn(start: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: start, callbackURLScheme: "ftrdose") { url, error in
                if let url { cont.resume(returning: url) } else { cont.resume(throwing: error ?? URLError(.cancelled)) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            session = s
            if !s.start() { cont.resume(throwing: URLError(.cannotLoadFromNetwork)) }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
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
    /// Called when the admin page wants a sign-in (true = Chef just signed out).
    var needsSignIn: (Bool) -> Void = { _ in }

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
        context.coordinator.loadedURL = url
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.loadedURL != url {
            context.coordinator.loadedURL = url
            web.load(URLRequest(url: url))
        } else if context.coordinator.lastReload != reloadToken {
            context.coordinator.lastReload = reloadToken
            web.reload()
        }
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        var parent: AdminWebView
        var lastReload = 0
        var loadedURL: URL?
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
            // The admin page's login (or its Google button) means Chef needs to sign in:
            // do that in the secure sign-in sheet, not in this web view.
            if target.host == ownHost, target.path == "/admin/login" || target.path == "/admin/google/start" {
                let out = target.query?.contains("out=1") == true
                decisionHandler(.cancel)
                parent.loading = false
                parent.needsSignIn(out)
                return
            }
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
