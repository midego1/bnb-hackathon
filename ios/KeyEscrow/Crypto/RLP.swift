import Foundation

/// Recursive Length Prefix encoding (Ethereum yellow paper, appendix B): just what a legacy transaction needs.
indirect enum RLP {
    case bytes(Data)
    case list([RLP])

    static func uint(_ v: BigUInt) -> RLP { .bytes(v.bytes) }
    static func uint(_ v: UInt64) -> RLP { .bytes(BigUInt(v).bytes) }

    var encoded: Data {
        switch self {
        case .bytes(let d):
            if d.count == 1, d[d.startIndex] < 0x80 { return d }
            return RLP.header(d.count, offset: 0x80) + d
        case .list(let items):
            let body = items.reduce(Data()) { $0 + $1.encoded }
            return RLP.header(body.count, offset: 0xc0) + body
        }
    }

    private static func header(_ length: Int, offset: UInt8) -> Data {
        if length < 56 { return Data([offset + UInt8(length)]) }
        let len = BigUInt(UInt64(length)).bytes
        return Data([offset + 55 + UInt8(len.count)]) + len
    }
}
