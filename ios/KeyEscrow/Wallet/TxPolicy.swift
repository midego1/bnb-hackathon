import Foundation

/// What this app is willing to sign, decided from the calldata itself, never from what the server says about it.
/// MockUSDT: `approve` only to a real escrow (and at most 10,000 tokens), `faucet` only to the signer.
/// EscrowFactory: `createLease` / `createLeaseWithPayee`. A rental escrow (checked on-chain with the factory's
/// `isLease`, through the app's own RPC): only RentalEscrow's own actions. Nothing else, no `transfer`, no other
/// contract.
enum TxPolicy {
    static let lease = "(address,address,uint256,uint256,uint32,uint32,uint32,uint32,bytes32)"
    static let approve = ABI.selector("approve(address,uint256)")
    static let faucet = ABI.selector("faucet(address,uint256)")
    static let factory: Set<Data> = [ABI.selector("createLease(\(lease))"), ABI.selector("createLeaseWithPayee(\(lease),address)")]
    static let escrow: Set<Data> = Set([
        "fund()", "payRent(uint32)", "releaseRent()", "addEvidence(uint8,bytes32)", "propose(uint256,bytes32)", "accept(uint32)",
        "claimTimeout()", "dispute()", "resolve(uint256,bytes32)", "claimArbiterTimeout()", "cancel()",
    ].map(ABI.selector))
    static let propose = ABI.selector("propose(uint256,bytes32)")
    static let maxApprove = BigUInt(10_000_000_000) // 10,000 mUSDT

    /// The n-th 32-byte argument word.
    static func word(_ data: Data, _ n: Int) -> Data? {
        let start = 4 + 32 * n
        guard data.count >= start + 32 else { return nil }
        return Data(data[data.startIndex + start ..< data.startIndex + start + 32])
    }

    static func address(_ data: Data, _ n: Int) -> String? {
        guard let w = word(data, n), w.prefix(12).allSatisfy({ $0 == 0 }) else { return nil }
        return EthAddress.checksum(w.suffix(20).hex0x)
    }

    /// Throws unless (to, data) is a call this app may sign for `signer`. `isEscrow` must answer from the chain.
    static func check(to: String, data: Data, signer: String, isEscrow: (String) async -> Bool) async throws {
        guard data.count >= 4 else { throw EthError.notAllowed("a call without a function") }
        let sel = Data(data.prefix(4))
        if EthAddress.same(to, TxSender.token) {
            if sel == approve, let spender = address(data, 0), let w = word(data, 1) {
                guard BigUInt(bytes: w) <= maxApprove else { throw EthError.notAllowed("approval above 10,000 mUSDT") }
                guard await isEscrow(spender) else { throw EthError.notAllowed("approval for \(spender), which is not a KeyScrow rental") }
                return
            }
            if sel == faucet, let dest = address(data, 0), EthAddress.same(dest, signer) { return }
            throw EthError.notAllowed("only approve (to a rental) and faucet (to yourself) on MockUSDT")
        }
        if EthAddress.same(to, TxSender.factory) {
            guard factory.contains(sel) else { throw EthError.notAllowed("only createLease on the factory") }
            return
        }
        guard escrow.contains(sel) else { throw EthError.notAllowed("not a rental action") }
        guard await isEscrow(to) else { throw EthError.notAllowed("\(to) is not a KeyScrow rental") }
    }
}

/// `EscrowFactory.isLease(address)` read through the app's own BSC testnet RPC; only `true` answers are cached.
actor EscrowRegistry {
    static let shared = EscrowRegistry()
    private var known = Set<String>()
    private let rpc = RPC()

    func isEscrow(_ a: String) async -> Bool {
        guard EthAddress.isValid(a) else { return false }
        if known.contains(a.lowercased()) { return true }
        guard let data = try? ABI.selector("isLease(address)") + ABI.address(a),
              let r: String = try? await rpc.call("eth_call", [["to": TxSender.factory, "data": data.hex0x], "latest"], as: String.self),
              let v = BigUInt(hex: r), !v.isZero else { return false }
        known.insert(a.lowercased())
        return true
    }
}
