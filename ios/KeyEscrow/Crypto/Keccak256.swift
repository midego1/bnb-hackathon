import Foundation

/// Keccak-256 (the Ethereum variant: original Keccak padding 0x01, not SHA3's 0x06). Small and dependency-free;
/// tested against viem's keccak256 in KeyEscrowTests.
enum Keccak256 {
    private static let rc: [UInt64] = [
        0x0000000000000001, 0x0000000000008082, 0x800000000000808A, 0x8000000080008000,
        0x000000000000808B, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
        0x000000000000008A, 0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
        0x000000008000808B, 0x800000000000008B, 0x8000000000008089, 0x8000000000008003,
        0x8000000000008002, 0x8000000000000080, 0x000000000000800A, 0x800000008000000A,
        0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
    ]
    private static let rotations: [Int] = [
        0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14,
    ]

    @inline(__always) private static func rotl(_ x: UInt64, _ n: Int) -> UInt64 { n == 0 ? x : (x << UInt64(n)) | (x >> UInt64(64 - n)) }

    private static func permute(_ a: inout [UInt64]) {
        var c = [UInt64](repeating: 0, count: 5)
        var b = [UInt64](repeating: 0, count: 25)
        for round in 0..<24 {
            for x in 0..<5 { c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20] }
            for x in 0..<5 {
                let d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1)
                for y in stride(from: 0, to: 25, by: 5) { a[y + x] ^= d }
            }
            for x in 0..<5 {
                for y in 0..<5 {
                    let i = x + 5 * y
                    b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[i], rotations[i])
                }
            }
            for y in stride(from: 0, to: 25, by: 5) {
                for x in 0..<5 { a[y + x] = b[y + x] ^ (~b[y + (x + 1) % 5] & b[y + (x + 2) % 5]) }
            }
            a[0] ^= rc[round]
        }
    }

    static func hash(_ data: Data) -> Data {
        let rate = 136
        var state = [UInt64](repeating: 0, count: 25)
        var msg = [UInt8](data)
        msg.append(0x01)
        while msg.count % rate != 0 { msg.append(0) }
        msg[msg.count - 1] |= 0x80
        for block in stride(from: 0, to: msg.count, by: rate) {
            for i in 0..<(rate / 8) {
                var lane: UInt64 = 0
                for j in 0..<8 { lane |= UInt64(msg[block + i * 8 + j]) << UInt64(8 * j) }
                state[i] ^= lane
            }
            permute(&state)
        }
        var out = Data(capacity: 32)
        for i in 0..<4 {
            for j in 0..<8 { out.append(UInt8((state[i] >> UInt64(8 * j)) & 0xff)) }
        }
        return out
    }

    static func hash(_ string: String) -> Data { hash(Data(string.utf8)) }
}
