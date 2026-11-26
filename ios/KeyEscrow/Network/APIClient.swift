import Foundation

struct APIError: LocalizedError, Equatable {
    let status: Int
    let message: String
    let code: String?
    var errorDescription: String? { message }
}

/// The live KeyEscrow web API. Read actions and prepare_* return JSON; nothing here ever signs.
struct APIClient {
    static let defaultBase = URL(string: "https://keyescrow-web.mdgooijer.workers.dev")!
    var base: URL = APIClient.defaultBase
    var session: URLSession = .shared

    static let decoder = JSONDecoder()

    func url(_ path: String, _ query: [String: String] = [:]) -> URL {
        var c = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { c.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        return c.url!
    }

    func absolute(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http") { return URL(string: path) }
        return URL(string: path, relativeTo: base)?.absoluteURL
    }

    private func send<T: Decodable>(_ req: URLRequest, as: T.Type) async throws -> T {
        var req = req
        req.setValue("application/json", forHTTPHeaderField: "accept")
        req.timeoutInterval = req.timeoutInterval == 60 ? 45 : req.timeoutInterval
        let (data, resp) = try await session.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if let e = try? APIClient.decoder.decode(APIErrorBody.self, from: data) { throw APIError(status: status, message: e.error, code: e.code) }
            throw APIError(status: status, message: "The server did not answer (HTTP \(status)). Try again.", code: nil)
        }
        do { return try APIClient.decoder.decode(T.self, from: data) } catch {
            throw APIError(status: status, message: "Unexpected answer from the server (\(error.localizedDescription)).", code: "decode")
        }
    }

    func get<T: Decodable>(_ path: String, _ query: [String: String] = [:], as t: T.Type) async throws -> T {
        try await send(URLRequest(url: url(path, query)), as: t)
    }

    func post<T: Decodable>(_ path: String, json: [String: Any], as t: T.Type) async throws -> T {
        var req = URLRequest(url: url(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: json)
        return try await send(req, as: t)
    }

    // MARK: Rental actions (/api/v1)

    func getLease(_ lease: String) async throws -> Lease {
        try await get("api/v1/get_lease", ["lease": lease, "chainId": "\(Chain.id)"], as: Lease.self)
    }

    func listLeases(party: String) async throws -> LeaseList {
        try await get("api/v1/list_leases", ["party": party, "chainId": "\(Chain.id)", "limit": "50"], as: LeaseList.self)
    }

    func explainStatus(lease: String, viewer: String?) async throws -> ExplainStatus {
        var q = ["lease": lease, "chainId": "\(Chain.id)"]
        if let viewer { q["viewer"] = viewer }
        return try await get("api/v1/explain_status", q, as: ExplainStatus.self)
    }

    /// POST /api/v1/prepare_<action> with `body` (+ chainId 97).
    func prepare(_ action: String, _ body: [String: Any]) async throws -> Prepared {
        var b = body
        b["chainId"] = Chain.id
        return try await post("api/v1/prepare_\(action)", json: b, as: Prepared.self)
    }

    // MARK: Data

    func fleet() async throws -> Fleet { try await get("api/fleet", as: Fleet.self) }
    func price() async throws -> PriceQuote { try await get("api/price", as: PriceQuote.self) }
    func chainIndex(minBlock: String? = nil) async throws -> ChainIndex {
        var q = ["chainId": "\(Chain.id)"]
        if let minBlock { q["minBlock"] = minBlock }
        return try await get("api/chain/index", q, as: ChainIndex.self)
    }

    // MARK: Live stage demo (/api/stage/<slug>)

    func stage(_ slug: String, renter: String?) async throws -> StageStatus {
        try await get("api/stage/\(slug)", renter.map { ["renter": $0] } ?? [:], as: StageStatus.self)
    }

    struct DripResult: Codable { let txs: [String]; let `repeat`: Bool? }
    struct LeaseResult: Codable { let lease: String; let `repeat`: Bool? }

    func stageDrip(_ slug: String, to address: String) async throws -> DripResult {
        try await post("api/stage/\(slug)", json: ["action": "drip", "address": address], as: DripResult.self)
    }

    func stageLease(_ slug: String, renter: String) async throws -> LeaseResult {
        try await post("api/stage/\(slug)", json: ["action": "lease", "address": renter], as: LeaseResult.self)
    }

    // MARK: Inspection + evidence

    func inspect(deposit: BigUInt, checkIn: [String], checkOut: [String], scooterId: String?, notes: String?, lease: String?) async throws -> Inspection {
        var body: [String: Any] = [
            "deposit": deposit.description, "decimals": 6, "currency": "USDT",
            "checkIn": checkIn.map { ["hash": $0] }, "checkOut": checkOut.map { ["hash": $0] },
        ]
        if let scooterId { body["scooterId"] = scooterId }
        if let notes { body["notes"] = notes }
        if let lease { body["lease"] = lease; body["chainId"] = Chain.id }
        var req = URLRequest(url: url("api/settlement"))
        req.httpMethod = "POST"
        req.timeoutInterval = 90
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(req, as: Inspection.self)
    }

    /// Multipart upload of JPEG photos; returns the server's content hashes (sha256, same as ours).
    func uploadEvidence(_ jpegs: [Data]) async throws -> EvidenceUpload {
        let boundary = "keyescrow-\(UUID().uuidString)"
        var body = Data()
        for (i, d) in jpegs.enumerated() {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"photo-\(i + 1).jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8))
            body.append(d)
            body.append(Data("\r\n".utf8))
        }
        body.append(Data("--\(boundary)--\r\n".utf8))
        var req = URLRequest(url: url("api/evidence"))
        req.httpMethod = "POST"
        req.timeoutInterval = 60
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "content-type")
        req.httpBody = body
        return try await send(req, as: EvidenceUpload.self)
    }
}
