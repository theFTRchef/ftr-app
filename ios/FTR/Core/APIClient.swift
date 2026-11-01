import Foundation
import Security

/// Error the server explained in words the customer can read.
struct APIError: LocalizedError, Equatable {
    let message: String
    let code: String?
    let status: Int
    var extra: [String: Double] = [:]
    var canAskChef = false
    var errorDescription: String? { message }

    static func offline() -> APIError {
        APIError(message: "Can't reach Franklin Tiffin Room. Check your internet connection and try again.", code: "offline", status: 0)
    }
}

/// Talks to the FTR server's /api/v1 endpoints (src/appApi.js).
final class APIClient {
    static let shared = APIClient()

    /// Set in Info.plist as FTRAPIBaseURL, e.g. https://bot.franklintiffinroom.com/api/v1
    let baseURL: URL
    var token: String? {
        get { Keychain.read("ftr.session") }
        set { newValue == nil ? Keychain.delete("ftr.session") : Keychain.save("ftr.session", newValue!) }
    }
    var onSignedOut: (() -> Void)?

    private let session: URLSession
    private let decoder = JSONDecoder()

    private init() {
        let raw = Bundle.main.object(forInfoDictionaryKey: "FTRAPIBaseURL") as? String
        baseURL = URL(string: raw ?? "") ?? URL(string: "https://bot.franklintiffinroom.com/api/v1")!
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 30
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: cfg)
    }

    /// Absolute URL for a path the server returns (e.g. "/zelle-qr?v=123").
    func absolute(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        comps?.path = ""
        comps?.query = nil
        return URL(string: path, relativeTo: comps?.url)?.absoluteURL
    }

    // MARK: requests

    func get<T: Decodable>(_ path: String, query: [String: String] = [:]) async throws -> T {
        try await send("GET", path, query: query, body: Optional<Empty>.none)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, _ body: B) async throws -> T {
        try await send("POST", path, body: body)
    }

    func put<T: Decodable, B: Encodable>(_ path: String, _ body: B) async throws -> T {
        try await send("PUT", path, body: body)
    }

    func delete<T: Decodable>(_ path: String) async throws -> T {
        try await send("DELETE", path, body: Optional<Empty>.none)
    }

    func upload<T: Decodable>(_ path: String, data: Data, contentType: String) async throws -> T {
        var req = request("POST", path, query: [:])
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        req.httpBody = data
        req.timeoutInterval = 90
        return try await run(req)
    }

    struct Empty: Codable {}
    struct OK: Decodable { let ok: Bool? }

    private func request(_ method: String, _ path: String, query: [String: String]) -> URLRequest {
        var comps = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
        req.setValue("FTR-iOS/\(version)", forHTTPHeaderField: "User-Agent")
        return req
    }

    private func send<T: Decodable, B: Encodable>(_ method: String, _ path: String, query: [String: String] = [:], body: B?) async throws -> T {
        var req = request(method, path, query: query)
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        return try await run(req)
    }

    private func run<T: Decodable>(_ req: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            if (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw APIError.offline()
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            var err = APIError(message: "Something went wrong. Please try again.", code: nil, status: status)
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                err = APIError(message: obj["error"] as? String ?? err.message, code: obj["code"] as? String, status: status)
                for (k, v) in obj { if let n = v as? Double { err.extra[k] = n } }
                err.canAskChef = obj["canAskChef"] as? Bool ?? false
            }
            if status == 401 {
                token = nil
                await MainActor.run { onSignedOut?() }
            }
            throw err
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            #if DEBUG
            print("Decode \(T.self) failed:", error)
            #endif
            throw APIError(message: "The app needs an update to read this. Please update from the App Store.", code: "decode", status: status)
        }
    }
}

/// Minimal Keychain wrapper for the sign-in token.
enum Keychain {
    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: Bundle.main.bundleIdentifier ?? "FTR",
         kSecAttrAccount as String: key]
    }

    static func save(_ key: String, _ value: String) {
        delete(key)
        var q = query(key)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(q as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        var q = query(key)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        SecItemDelete(query(key) as CFDictionary)
    }
}
