import Foundation

/// Ask AI against POST /api/assistant (Server-Sent Events, web/lib/assistant/events.ts). The server never signs:
/// an approval card carries the exact unsigned steps, which this phone signs with the guest wallet on approve.
@MainActor
final class AskAIModel: ObservableObject {
    struct Approval: Equatable {
        let id: String
        let title: String
        let summary: String
        let steps: [String]
        let lease: String?
        let txs: [[String: String]]
        var state: State = .waiting
        enum State: Equatable { case waiting, signing, approved, declined }
    }

    enum Item: Identifiable, Equatable {
        case user(UUID, String)
        case answer(UUID, String)
        case step(String, String, String) // id, label, state
        case card(UUID, String, String?, [String]) // title, subtitle, tx hashes
        case approval(Approval)
        case error(UUID, String)

        var id: String {
            switch self {
            case .user(let u, _), .answer(let u, _), .card(let u, _, _, _), .error(let u, _): return u.uuidString
            case .step(let s, _, _): return "step-" + s
            case .approval(let a): return "approval-" + a.id
            }
        }
    }

    @Published var items: [Item] = []
    @Published var running = false
    @Published var mock = false
    private var chatId = AskAIModel.newChatId()
    private let api = APIClient()
    private let sender = TxSender()

    static func newChatId() -> String {
        let chars = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        return "ios_" + String((0..<20).map { _ in chars.randomElement()! })
    }

    func newChat() { items = []; chatId = Self.newChatId() }

    func send(_ text: String, address: String) {
        let msg = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !msg.isEmpty, !running else { return }
        items.append(.user(UUID(), msg))
        Task { await run(["chatId": chatId, "message": msg, "context": context(address)]) }
    }

    private func context(_ address: String) -> [String: Any] { ["path": "/tenant", "address": address, "chainId": Chain.id] }

    func answer(_ a: Approval, approve: Bool, wallet: WalletStore) {
        guard !running else { return }
        update(a.id) { $0.state = approve ? .signing : .declined }
        Task {
            var resume: [String: Any] = ["approvalId": a.id, "decision": approve ? "approve" : "decline"]
            if approve {
                do {
                    var hashes: [String] = []
                    for tx in a.txs {
                        guard let to = tx["to"], let data = Data(hex: tx["data"] ?? ""), BigUInt(tx["value"] ?? "0")?.isZero ?? false else { throw EthError.notAllowed("unexpected step") }
                        guard await sender.isAllowedTarget(to, lease: a.lease) else { throw EthError.notAllowed("\(to) is not a KeyEscrow contract") }
                        hashes.append(try await sender.send(key: wallet.guest, to: to, data: data, value: BigUInt(), description: a.title).hash)
                    }
                    resume["txHashes"] = hashes
                    update(a.id) { $0.state = .approved }
                } catch {
                    resume["decision"] = "decline"
                    resume["error"] = String(error.localizedDescription.prefix(280))
                    update(a.id) { $0.state = .declined }
                    items.append(.error(UUID(), error.localizedDescription))
                }
            }
            await run(["chatId": chatId, "resume": resume, "context": context(wallet.address)])
            await wallet.refresh()
        }
    }

    private func update(_ id: String, _ f: (inout Approval) -> Void) {
        for (i, it) in items.enumerated() { if case .approval(var a) = it, a.id == id { f(&a); items[i] = .approval(a) } }
    }

    private func run(_ body: [String: Any]) async {
        running = true
        defer { running = false }
        var req = URLRequest(url: api.url("api/assistant"))
        req.httpMethod = "POST"
        req.timeoutInterval = 180
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.setValue("text/event-stream", forHTTPHeaderField: "accept")
        do {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (bytes, resp) = try await URLSession.shared.bytes(for: req)
            if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
                var data = Data()
                for try await b in bytes { data.append(b) }
                let msg = (try? JSONDecoder().decode(APIErrorBody.self, from: data))?.error ?? "HTTP \(h.statusCode)"
                items.append(.error(UUID(), msg))
                return
            }
            var answerId: UUID?
            for try await line in bytes.lines {
                guard line.hasPrefix("data:") else { continue }
                let json = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                guard let e = try? JSONDecoder().decode([String: JSONValue].self, from: Data(json.utf8)), let type = e["type"]?.string else { continue }
                handle(type, e, answerId: &answerId)
            }
        } catch {
            items.append(.error(UUID(), error.localizedDescription))
        }
    }

    func handle(_ type: String, _ e: [String: JSONValue], answerId: inout UUID?) {
        switch type {
        case "run_started":
            if case .bool(let m)? = e["mock"] { mock = m }
        case "text_delta":
            let t = e["text"]?.string ?? ""
            if let id = answerId, let i = items.firstIndex(where: { $0.id == id.uuidString }), case .answer(_, let old) = items[i] {
                items[i] = .answer(id, old + t)
            } else {
                let id = UUID(); answerId = id
                items.append(.answer(id, t))
            }
        case "step":
            let id = e["id"]?.string ?? UUID().uuidString
            let item = Item.step(id, e["label"]?.string ?? "", e["state"]?.string ?? "")
            if let i = items.firstIndex(where: { $0.id == "step-" + id }) { items[i] = item } else { items.append(item) }
            answerId = nil
        case "card":
            guard case .object(let c)? = e["card"] else { return }
            items.append(Self.card(c))
            answerId = nil
        case "approval_required":
            guard case .object(let c)? = e["card"], let id = c["id"]?.string else { return }
            var txs: [[String: String]] = []
            if case .array(let arr)? = e["txs"] {
                for t in arr { if case .object(let o) = t { txs.append(o.compactMapValues { $0.string }) } }
            }
            var steps: [String] = []
            if case .array(let arr)? = c["steps"] { for s in arr { if case .object(let o) = s, let d = o["description"]?.string { steps.append(d) } } }
            items.append(.approval(Approval(id: id, title: c["title"]?.string ?? "", summary: c["summary"]?.string ?? "", steps: steps, lease: c["lease"]?.string, txs: txs)))
            answerId = nil
        case "error":
            items.append(.error(UUID(), e["message"]?.string ?? "Error"))
        default: break
        }
    }

    /// A server-built card as title + subtitle (+ tx hashes for a done card).
    static func card(_ c: [String: JSONValue]) -> Item {
        let kind = c["kind"]?.string ?? ""
        func obj(_ k: String) -> [String: JSONValue]? { if case .object(let o)? = c[k] { return o }; return nil }
        switch kind {
        case "lease":
            let dep = obj("deposit").flatMap { $0["thb"]?.string ?? $0["token"]?.string } ?? ""
            return .card(UUID(), (c["statusLabel"]?.string ?? "") + " · " + EthAddress.short(c["address"]?.string ?? ""), (c["headline"]?.string ?? "") + (dep.isEmpty ? "" : "\nDeposit \(dep)"), [])
        case "lease_list":
            let n = obj("totals")?["all"]?.int ?? 0
            return .card(UUID(), "\(n) rentals", obj("totals").flatMap { $0["open"]?.int }.map { "\($0) open" }, [])
        case "done":
            var hashes: [String] = []
            if case .array(let arr)? = c["txs"] { for t in arr { if case .object(let o) = t, let h = o["hash"]?.string { hashes.append(h) } } }
            return .card(UUID(), c["title"]?.string ?? "Done", nil, hashes)
        default:
            return .card(UUID(), c["title"]?.string ?? kind, c["summary"]?.string, [])
        }
    }
}
