import Foundation

struct RPCEnvelope<T: Decodable>: Decodable { struct E: Decodable { let message: String }; let result: T?; let error: E? }

/// Minimal JSON-RPC client for BSC testnet. The app checks eth_chainId == 97 before every send.
struct RPC {
    var url: URL = Chain.rpc
    var session: URLSession = .shared

    struct RPCError: LocalizedError { let message: String; var errorDescription: String? { message } }

    func call<T: Decodable>(_ method: String, _ params: [Any], as: T.Type) async throws -> T {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["jsonrpc": "2.0", "id": 1, "method": method, "params": params])
        var lastError: Error = RPCError(message: "The chain node did not answer.")
        for attempt in 0..<3 {
            do {
                let (data, _) = try await session.data(for: req)
                let env = try JSONDecoder().decode(RPCEnvelope<T>.self, from: data)
                if let e = env.error { throw RPCError(message: e.message) }
                if let r = env.result { return r }
                // null result (e.g. a receipt that is not mined yet)
                throw RPCError(message: "null")
            } catch let e as RPCError {
                throw e
            } catch {
                lastError = error
                try? await Task.sleep(nanoseconds: UInt64(400_000_000 * (attempt + 1)))
            }
        }
        throw lastError
    }

    func chainId() async throws -> Int {
        let h: String = try await call("eth_chainId", [], as: String.self)
        return Int(h.dropFirst(2), radix: 16) ?? -1
    }

    func balance(_ a: String) async throws -> BigUInt {
        BigUInt(hex: try await call("eth_getBalance", [a, "latest"], as: String.self)) ?? BigUInt()
    }

    func tokenBalance(token: String, owner: String) async throws -> BigUInt {
        let data = try ABI.balanceOf(owner).hex0x
        let r: String = try await call("eth_call", [["to": token, "data": data], "latest"], as: String.self)
        return BigUInt(hex: r) ?? BigUInt()
    }

    func nonce(_ a: String) async throws -> UInt64 {
        let h: String = try await call("eth_getTransactionCount", [a, "pending"], as: String.self)
        return UInt64(h.dropFirst(2), radix: 16) ?? 0
    }

    func gasPrice() async throws -> BigUInt { BigUInt(hex: try await call("eth_gasPrice", [], as: String.self)) ?? BigUInt(100_000_000) }

    func estimateGas(from: String, to: String, data: String, value: BigUInt) async throws -> UInt64 {
        let h: String = try await call("eth_estimateGas", [["from": from, "to": to, "data": data, "value": value.hexQuantity]], as: String.self)
        return UInt64(h.dropFirst(2), radix: 16) ?? 0
    }

    func sendRaw(_ raw: Data) async throws -> String { try await call("eth_sendRawTransaction", [raw.hex0x], as: String.self) }

    func receipt(_ hash: String) async throws -> TxReceipt? {
        do { return try await call("eth_getTransactionReceipt", [hash], as: TxReceipt.self) } catch let e as RPCError where e.message == "null" { return nil }
    }
}
