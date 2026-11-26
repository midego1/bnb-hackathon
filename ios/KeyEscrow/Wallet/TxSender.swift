import Foundation

/// Signs and sends transactions with a local test key, one at a time, waiting for each receipt.
/// Safety: BSC testnet only (the prepared chainId, the RPC's eth_chainId and the signer all must say 97), only to
/// KeyScrow's own contracts (or the app's own wallets), never with value on a prepared step, gas and gas price capped.
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

    /// Throws unless the app's policy allows this call (TxPolicy; escrows are checked on-chain, not with the API).
    func checkPolicy(to: String, data: Data, signer: String) async throws {
        try await TxPolicy.check(to: to, data: data, signer: signer) { await EscrowRegistry.shared.isEscrow($0) }
    }

    /// Runs prepare_* steps in order with `key`. Every step passes TxPolicy before it is signed.
    func run(_ p: Prepared, key: EthKey, onSent: (Sent) -> Void = { _ in }) async throws -> [Sent] {
        guard p.chainId == Chain.id else { throw EthError.wrongChain(p.chainId) }
        guard EthAddress.same(p.from, key.address) else { throw EthError.notAllowed("prepared for another wallet") }
        if p.simulation?.ok == false { throw SendError.message("The chain says this would fail right now. Refresh and try again.") }
        var out: [Sent] = []
        for step in p.steps {
            guard let value = BigUInt(step.value), value.isZero else { throw EthError.notAllowed("a prepared step wants to send tBNB") }
            guard let data = Data(hex: step.data) else { throw EthError.notAllowed("bad calldata") }
            try await checkPolicy(to: step.to, data: data, signer: key.address)
            let s = try await send(key: key, to: step.to, data: data, value: BigUInt(), description: step.description)
            out.append(s)
            onSent(s)
        }
        return out
    }

    /// One transaction: sign, send, wait for the receipt, require success.
    func send(key: EthKey, to: String, data: Data, value: BigUInt, description: String, fixedGas: UInt64? = nil) async throws -> Sent {
        let hash = try await signAndSend(key: key, to: to, data: data, value: value, description: description, fixedGas: fixedGas)
        let receipt = try await waitForReceipt(hash)
        guard receipt.succeeded else { throw SendError.reverted(hash) }
        return Sent(description: description, hash: hash, block: receipt.blockNumber)
    }

    /// Nonce, gas price and gas from the node, sign locally, broadcast; returns the hash without waiting. `onHash` gets
    /// the hash before it is broadcast, so a caller can remember it across a crash or a timeout.
    func signAndSend(key: EthKey, to: String, data: Data, value: BigUInt = BigUInt(), description: String, fixedGas: UInt64? = nil, onHash: (String) -> Void = { _ in }) async throws -> String {
        let chain = try await rpc.chainId()
        guard chain == Chain.id else { throw EthError.wrongChain(chain) }
        async let nonceF = rpc.nonce(key.address)
        async let priceF = rpc.gasPrice()
        var gasPrice = try await priceF
        if gasPrice < Self.minGasPrice { gasPrice = Self.minGasPrice }
        guard gasPrice <= Self.maxGasPrice else { throw EthError.notAllowed("gas price above 10 gwei") }
        let gas: UInt64
        if let fixedGas { gas = fixedGas } else {
            let est: UInt64
            do { est = try await rpc.estimateGas(from: key.address, to: to, data: data.hex0x, value: value) } catch {
                throw SendError.message("The chain says this would fail: \(error.localizedDescription)")
            }
            guard est <= Self.maxGas else { throw EthError.notAllowed("gas \(est) is above the cap") }
            gas = min(Self.maxGas, est + est / 4 + 10_000)
        }
        guard gas <= Self.maxGas else { throw EthError.notAllowed("gas \(gas) is above the cap") }
        let tx = LegacyTransaction(nonce: try await nonceF, gasPrice: gasPrice, gas: gas, to: to, value: value, data: data, chainId: Chain.id)
        let raw = try tx.signed(with: key)
        let hash = LegacyTransaction.hash(ofRaw: raw)
        onHash(hash)
        do {
            let answered = try await rpc.sendRaw(raw)
            guard answered.lowercased() == hash.lowercased() else { throw SendError.message("The node answered another transaction hash.") }
        } catch {
            // The node may have taken it even if the answer got lost (or says "already known"): look it up by hash
            // before giving up, so a retry never signs a second transaction.
            let known = error.localizedDescription.lowercased().contains("already known")
            if !known, (try? await rpc.transaction(hash)) == nil { throw SendError.message(error.localizedDescription) }
        }
        return hash
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
