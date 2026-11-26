import Foundation
import P256K

/// A secp256k1 private key with its Ethereum address. Signing is RFC 6979 deterministic with low-s (libsecp256k1),
/// so the output matches viem / ethers byte for byte (see SignerTests).
struct EthKey {
    let privateKey: Data
    let address: String

    init(privateKey: Data) throws {
        guard privateKey.count == 32 else { throw EthError.badKey }
        let signing = try P256K.Signing.PrivateKey(dataRepresentation: privateKey, format: .uncompressed)
        let pub = signing.publicKey.dataRepresentation // 0x04 || X || Y
        guard pub.count == 65 else { throw EthError.badKey }
        let hash = Keccak256.hash(pub.dropFirst())
        self.privateKey = privateKey
        self.address = EthAddress.checksum(hash.suffix(20).hex0x)
    }

    static func generate() throws -> EthKey {
        var bytes = Data(count: 32)
        let ok = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard ok == errSecSuccess else { throw EthError.badKey }
        return try EthKey(privateKey: bytes) // libsecp256k1 rejects the (astronomically unlikely) invalid scalar
    }

    /// Recoverable signature over a 32-byte digest: (r, s, recoveryId 0/1).
    func sign(digest: Data) throws -> (r: Data, s: Data, recId: UInt8) {
        guard digest.count == 32 else { throw EthError.badDigest }
        let key = try P256K.Recovery.PrivateKey(dataRepresentation: privateKey)
        let sig = key.signature(for: try HashDigest([UInt8](digest)))
        let compact = sig.compactRepresentation
        let rs = compact.signature
        return (Data(rs.prefix(32)), Data(rs.suffix(32)), UInt8(compact.recoveryId))
    }
}

enum EthError: LocalizedError, Equatable {
    case badKey, badDigest, badAddress(String), wrongChain(Int), notAllowed(String)

    var errorDescription: String? {
        switch self {
        case .badKey: return "The wallet key is not valid."
        case .badDigest: return "Internal error: digest must be 32 bytes."
        case .badAddress(let a): return "Not an address: \(a)"
        case .wrongChain(let id): return "Refusing to sign for chain \(id). This app signs only on BSC testnet (chain 97)."
        case .notAllowed(let why): return "Refusing to sign: \(why)"
        }
    }
}

enum EthAddress {
    static func isValid(_ a: String) -> Bool { Hex.isHex(a, bytes: 20) }

    /// EIP-55 mixed-case checksum.
    static func checksum(_ a: String) -> String {
        let lower = String(a.lowercased().dropFirst(2))
        let hash = Keccak256.hash(lower).hex
        var out = "0x"
        for (c, h) in zip(lower, hash) {
            if c.isLetter, let v = Int(String(h), radix: 16), v >= 8 { out.append(c.uppercased()) } else { out.append(c) }
        }
        return out
    }

    static func same(_ a: String?, _ b: String?) -> Bool {
        guard let a, let b else { return false }
        return a.lowercased() == b.lowercased()
    }

    static func short(_ a: String) -> String { a.count > 12 ? "\(a.prefix(6))…\(a.suffix(4))" : a }
}
