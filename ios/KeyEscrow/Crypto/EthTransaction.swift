import Foundation

/// The only chain this app ever signs for: BSC testnet.
enum Chain {
    static let id = 97
    static let name = "BSC testnet"
    static let rpc = URL(string: "https://bsc-testnet-rpc.publicnode.com")!
    static func txURL(_ hash: String) -> URL { URL(string: "https://testnet.bscscan.com/tx/\(hash)")! }
    static func addressURL(_ a: String) -> URL { URL(string: "https://testnet.bscscan.com/address/\(a)")! }
}

/// A legacy (type 0) transaction signed with EIP-155 replay protection.
struct LegacyTransaction: Equatable {
    var nonce: UInt64
    var gasPrice: BigUInt
    var gas: UInt64
    var to: String
    var value: BigUInt
    var data: Data
    var chainId: Int

    private func fields() throws -> [RLP] {
        guard EthAddress.isValid(to), let toBytes = Data(hex: to) else { throw EthError.badAddress(to) }
        return [.uint(nonce), .uint(gasPrice), .uint(gas), .bytes(toBytes), .uint(value), .bytes(data)]
    }

    /// RLP(nonce, gasPrice, gas, to, value, data, chainId, 0, 0): what gets hashed and signed.
    func signingPayload() throws -> Data {
        try RLP.list(fields() + [.uint(UInt64(chainId)), .bytes(Data()), .bytes(Data())]).encoded
    }

    /// The raw signed transaction for eth_sendRawTransaction. Refuses any chain but BSC testnet.
    func signed(with key: EthKey) throws -> Data {
        guard chainId == Chain.id else { throw EthError.wrongChain(chainId) }
        let digest = Keccak256.hash(try signingPayload())
        let sig = try key.sign(digest: digest)
        let v = UInt64(sig.recId) + UInt64(chainId) * 2 + 35
        let strip = { (d: Data) in Data(d.drop(while: { $0 == 0 })) }
        return try RLP.list(fields() + [.uint(v), .bytes(strip(sig.r)), .bytes(strip(sig.s))]).encoded
    }

    static func hash(ofRaw raw: Data) -> String { Keccak256.hash(raw).hex0x }
}

/// Just enough ABI encoding for the calls the app builds itself (everything else comes from /api/v1 prepare_*).
enum ABI {
    static func selector(_ signature: String) -> Data { Keccak256.hash(signature).prefix(4) }

    static func address(_ a: String) throws -> Data {
        guard EthAddress.isValid(a), let d = Data(hex: a) else { throw EthError.badAddress(a) }
        return Data(repeating: 0, count: 12) + d
    }

    /// MockUSDT.faucet(address,uint256): anyone may mint up to 10,000 test tokens per call (testnet only).
    static func faucet(to: String, amount: BigUInt) throws -> Data {
        selector("faucet(address,uint256)") + (try address(to)) + amount.word
    }

    static func balanceOf(_ owner: String) throws -> Data { selector("balanceOf(address)") + (try address(owner)) }
}
