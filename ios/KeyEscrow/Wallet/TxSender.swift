import Foundation

/// Signs and sends transactions with a local test key, one at a time, waiting for each receipt.
/// Safety: BSC testnet only (the prepared chainId, the RPC's eth_chainId and the signer all must say 97), only to
/// KeyEscrow's own contracts (or the app's own wallets), never with value on a prepared step, gas and gas price capped.
struct TxSender {
    var rpc = RPC()
    var api = APIClient()

    static let token = "0x7aF0035c254bC760231BCcFF3403A714611c35B1"   // MockUSDT (contracts/deployments/97.json)
    static let factory = "0x04D7dDCb72802aF82296110A90526342C1249315" // EscrowFactory v2
    static let maxGas: UInt64 = 1_500_000
    static let maxGasPrice = BigUInt(10_000_000_000) // 10 gwei
    static let minGasPrice = BigUInt(100_000_000)    // 0.1 gwei, BSC testnet's floor

    struct Sent: Equatable { let description: String; let hash: String; let block: String? }

    enum SendError: LocalizedError {
        case reverted(String), timeout(String), message(String)
        var errorDescription: String? {
            switch self {
            case .reverted(let h): return "The transaction was reverted on-chain (\(EthAddress.short(h))). Try again."
            case .timeout(let h): return "The transaction \(EthAddress.short(h)) is taking long. Pull to refresh in a minute."
            case .message(let m): return m
            }
        }
    }

    /// Is `to` a contract this app may call? MockUSDT, the factory, or a rental escrow the API confirms.
    func isAllowedTarget(_ to: String, lease: String?) async -> Bool {
        if EthAddress.same(to, Self.token) || EthAddress.same(to, Self.factory) { return true }
        if let lease, EthAddress.same(to, lease) { return true }
        return (try? await api.getLease(to)) != nil // the server answers 404 for anything that is not a KeyEscrow rental
    }

    /// Runs prepare_* steps in order with `key`.
    func run(_ p: Prepared, key: EthKey, lease: String?, onSent: (Sent) -> Void = { _ in }) async throws -> [Sent] {
        guard p.chainId == Chain.id else { throw EthError.wrongChain(p.chainId) }
        guard EthAddress.same(p.from, key.address) else { throw EthError.notAllowed("prepared for another wallet") }
        if p.simulation?.ok == false { throw SendError.message("The chain says this would fail right now. Refresh and try again.") }
        var out: [Sent] = []
        for step in p.steps {
            guard let value = BigUInt(step.value), value.isZero else { throw EthError.notAllowed("a prepared step wants to send tBNB") }
            guard await isAllowedTarget(step.to, lease: lease) else { throw EthError.notAllowed("\(step.to) is not a KeyEscrow contract") }
            guard let data = Data(hex: step.data) else { throw EthError.notAllowed("bad calldata") }
            let s = try await send(key: key, to: step.to, data: data, value: BigUInt(), description: step.description)
            out.append(s)
            onSent(s)
        }
        return out
    }

    /// One transaction: nonce, gas price and gas from the node, sign locally, send, wait for the receipt.
    func send(key: EthKey, to: String, data: Data, value: BigUInt, description: String, fixedGas: UInt64? = nil) async throws -> Sent {
        let chain = try await rpc.chainId()
        guard chain == Chain.id else { throw EthError.wrongChain(chain) }
        async let nonceF = rpc.nonce(key.address)
        async let priceF = rpc.gasPrice()
        var gasPrice = try await priceF
        if gasPrice < Self.minGasPrice { gasPrice = Self.minGasPrice }
        guard gasPrice <= Self.maxGasPrice else { throw EthError.notAllowed("gas price above 10 gwei") }
        let gas: UInt64
        if let fixedGas { gas = fixedGas } else {
            do {
                let est = try await rpc.estimateGas(from: key.address, to: to, data: data.hex0x, value: value)
                gas = est + est / 4 + 10_000
            } catch {
                throw SendError.message("The chain says this would fail: \(error.localizedDescription)")
            }
        }
        guard gas <= Self.maxGas else { throw EthError.notAllowed("gas \(gas) is above the cap") }
        let tx = LegacyTransaction(nonce: try await nonceF, gasPrice: gasPrice, gas: gas, to: to, value: value, data: data, chainId: Chain.id)
        let raw = try tx.signed(with: key)
        let expected = LegacyTransaction.hash(ofRaw: raw)
        var hash = expected
        do { hash = try await rpc.sendRaw(raw) } catch {
            // A retried send can answer "already known": the transaction is in the pool, carry on with its hash.
            if !error.localizedDescription.lowercased().contains("known") { throw SendError.message(error.localizedDescription) }
        }
        let receipt = try await waitForReceipt(hash)
        guard receipt.succeeded else { throw SendError.reverted(hash) }
        return Sent(description: description, hash: hash, block: receipt.blockNumber)
    }

    func waitForReceipt(_ hash: String, timeout: TimeInterval = 120) async throws -> TxReceipt {
        let start = Date()
        while Date().timeIntervalSince(start) < timeout {
            if let r = try? await rpc.receipt(hash) { return r }
            try await Task.sleep(nanoseconds: 1_500_000_000)
        }
        throw SendError.timeout(hash)
    }
}
