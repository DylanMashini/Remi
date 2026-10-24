import Foundation
import Security

/// Backend URL (UserDefaults) + bearer token (Keychain), and the URLSession helpers every upload uses.
final class BackendClient {
  static let shared = BackendClient()

  private let urlKey = "recall.backendUrl"
  private let keychainService = "com.recall.glasses"
  private let keychainAccount = "deviceToken"

  private(set) var backendUrl: String?
  private(set) var token: String?

  let session: URLSession = {
    let cfg = URLSessionConfiguration.default
    cfg.timeoutIntervalForRequest = 20
    cfg.timeoutIntervalForResource = 60
    cfg.waitsForConnectivity = false
    return URLSession(configuration: cfg)
  }()

  private init() {
    backendUrl = UserDefaults.standard.string(forKey: urlKey)
    token = readToken()
  }

  var isConfigured: Bool { backendUrl != nil && token != nil }

  func configure(backendUrl: String, token: String) {
    var url = backendUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    while url.hasSuffix("/") { url.removeLast() }
    self.backendUrl = url
    self.token = token
    UserDefaults.standard.set(url, forKey: urlKey)
    writeToken(token)
  }

  // MARK: Requests

  func request(_ path: String, method: String = "GET", contentType: String? = nil, body: Data? = nil, timeout: TimeInterval = 20) throws -> URLRequest {
    guard let base = backendUrl, let token = token else {
      throw GlassesError("Not configured. Call configure({ backendUrl, token }) first.")
    }
    guard let url = URL(string: base + path) else { throw GlassesError("Bad backend URL: \(base)\(path)") }
    var req = URLRequest(url: url, timeoutInterval: timeout)
    req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let contentType { req.setValue(contentType, forHTTPHeaderField: "Content-Type") }
    req.httpBody = body
    return req
  }

  /// Performs the request and returns (data, status). Throws on transport errors only.
  func send(_ req: URLRequest) async throws -> (Data, Int) {
    let (data, resp) = try await session.data(for: req)
    return (data, (resp as? HTTPURLResponse)?.statusCode ?? 0)
  }

  /// Sends and decodes a JSON object, throwing the server's `{error}` message on non-2xx.
  func sendJSON(_ req: URLRequest) async throws -> [String: Any] {
    let (data, status) = try await send(req)
    let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    guard (200..<300).contains(status) else {
      let msg = (obj?["error"] as? String) ?? String(data: data, encoding: .utf8)?.prefix(200).description ?? ""
      throw GlassesError("\(req.httpMethod ?? "") \(req.url?.path ?? "") failed (\(status)): \(msg)")
    }
    return obj ?? [:]
  }

  // MARK: Keychain

  private func baseQuery() -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: keychainService,
     kSecAttrAccount as String: keychainAccount]
  }

  private func writeToken(_ token: String) {
    SecItemDelete(baseQuery() as CFDictionary)
    var q = baseQuery()
    q[kSecValueData as String] = Data(token.utf8)
    q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(q as CFDictionary, nil)
    if status != errSecSuccess { NSLog("[Glasses] Keychain write failed: \(status)") }
  }

  private func readToken() -> String? {
    var q = baseQuery()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
}

struct GlassesError: LocalizedError, CustomStringConvertible {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
  var description: String { message }
}

/// Multipart/form-data builder.
struct Multipart {
  let boundary = "recall-\(UUID().uuidString)"
  private(set) var body = Data()

  var contentType: String { "multipart/form-data; boundary=\(boundary)" }

  mutating func addField(_ name: String, _ value: String) {
    body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n".data(using: .utf8)!)
  }

  mutating func addFile(_ name: String, filename: String, mime: String, data: Data) {
    body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".data(using: .utf8)!)
    body.append(data)
    body.append("\r\n".data(using: .utf8)!)
  }

  mutating func finish() -> Data {
    body.append("--\(boundary)--\r\n".data(using: .utf8)!)
    return body
  }
}
