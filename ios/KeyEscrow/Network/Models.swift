import Foundation

/// JSON shapes of the live KeyScrow API (https://keyscrow.mdgooijer.workers.dev). Fixtures in KeyEscrowTests.

/// Any JSON value (event args, error details).
enum JSONValue: Codable, Equatable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }

    /// A bigint in any of the server's encodings: {"$n": "1"}, "1" or 1.
    var big: BigUInt? {
        switch self {
        case .string(let s): return BigUInt(s)
        case .number(let n): return n >= 0 && n < 1e18 ? BigUInt(UInt64(n)) : nil
        case .object(let o): if case .string(let s)? = o["$n"] { return BigUInt(s) }; return nil
        default: return nil
        }
    }

    var int: Int? {
        if case .number(let n) = self { return Int(n) }
        return big.flatMap { Int($0.description) }
    }

    var string: String? { if case .string(let s) = self { return s }; return nil }
}

struct TokenAmount: Codable, Equatable {
    let units: BigUInt
    let display: String
}

struct FiatPair: Codable, Equatable {
    let THB: String
    let USD: String
    let mock: Bool?
}

/// GET /api/v1/get_lease
struct Lease: Codable, Equatable, Identifiable {
    struct Proposal: Codable, Equatable {
        let nonce: Int
        let proposer: String
        let proposerRole: String?
        let toRenter: TokenAmount
        let toOwner: TokenAmount
        let reportHash: String
        let proposedAt: String?
    }

    let address: String
    let chainId: Int
    let status: String
    let owner: String
    let renter: String
    let arbiter: String
    let payee: String?
    let token: String
    let rent: TokenAmount
    let deposit: TokenAmount
    let termPeriods: Int
    let rentPeriodDays: Double
    let responseWindowDays: Double?
    let arbiterWindowDays: Double?
    let leaseHash: String?
    let feeBps: Int?
    let startedAt: String?
    let periodsFunded: Int
    let periodsReleased: Int
    let periodsDue: Int
    let checkInHash: String
    let checkOutHash: String
    let proposal: Proposal?
    let renterTimeoutAt: String?
    let arbiterDeadline: String?
    let escrowBalance: TokenAmount
    let chainTime: String?
    let depositFiat: FiatPair?
    let rentFiat: FiatPair?

    var id: String { address }
    static let zeroHash = "0x" + String(repeating: "0", count: 64)
    var hasPickupPhotos: Bool { checkInHash != Lease.zeroHash }
    var hasReturnPhotos: Bool { checkOutHash != Lease.zeroHash }
    var isFinal: Bool { status == "Settled" || status == "Cancelled" }
}

/// GET /api/v1/list_leases
struct LeaseList: Codable, Equatable {
    struct Item: Codable, Equatable, Identifiable {
        let address: String
        let role: String
        let status: String
        let rent: TokenAmount
        let deposit: TokenAmount
        let termPeriods: Int
        let rentPeriodDays: Double
        var id: String { address + role }
    }

    let chainId: Int
    let party: String
    let count: Int
    let leases: [Item]
}

/// GET /api/v1/explain_status
struct ExplainStatus: Codable, Equatable {
    let lease: String
    let status: String
    let you: String?
    let headline: String
    let text: String
}

/// POST /api/v1/prepare_*: unsigned, simulated transactions for `from` to sign in order.
struct Prepared: Codable, Equatable {
    struct Step: Codable, Equatable {
        let to: String
        let data: String
        let value: String
        let description: String
        let function: String?
    }

    struct Simulation: Codable, Equatable { let method: String?; let ok: Bool }

    let chainId: Int
    let from: String
    let steps: [Step]
    let summary: String
    let simulation: Simulation?
    let expected: [String: JSONValue]?
    let unsigned: Bool?
}

struct APIErrorBody: Codable { let error: String; let code: String? }

/// GET /api/listings: the one listing catalogue, shared with the website (web/data/listings.json).
struct Catalogue: Codable, Equatable {
    struct Photo: Codable, Equatable {
        struct Credit: Codable, Equatable {
            let title: String
            let author: String
            let license: String
            let licenseUrl: String
            let source: String
            let changes: String
            let note: String?
        }
        /// Absolute URL of the 1200 px JPEG on the server that answered.
        let url: String
        let width: Int
        let height: Int
        let alt: String
        let credit: Credit
    }

    struct Item: Codable, Equatable, Identifiable {
        let slug: String
        let name: String
        let description: String
        let location: String
        let city: String
        let area: String?
        /// Rent per day; `monthThb` per month when the listing offers one (the scooters).
        let rentThb: Double
        let monthThb: Double?
        let depositThb: Double
        let stage: Bool
        let demo: Bool
        let photos: [Photo]
        var id: String { slug }
    }

    let thbPerUsdt: Double
    let listings: [Item]
}

/// GET /api/price
struct PriceQuote: Codable, Equatable {
    struct Rate: Codable, Equatable { let USD: Double; let THB: Double }
    let rates: [String: Rate]
    let source: String
    let mock: Bool?

    var thbPerUsdt: Double { rates["USDT"]?.THB ?? 33 }
}

/// GET /api/stage/<slug>: the live judge demo (bigints as {"$n"}).
struct StageStatus: Codable, Equatable {
    struct Listing: Codable, Equatable {
        let slug: String
        let name: String
        let description: String?
        let location: String?
        let photos: [String]?
        let rentThb: Double
        let depositThb: Double
    }

    struct Price: Codable, Equatable { let rent: BigUInt; let deposit: BigUInt; let thbPerUsdt: Double }
    struct Rental: Codable, Equatable { let lease: String; let renter: String; let createdAt: Double }
    struct Creating: Codable, Equatable { let renter: String; let at: Double }
    struct Me: Codable, Equatable { let address: String; let bnb: BigUInt; let musdt: BigUInt }
    struct Drip: Codable, Equatable { let txs: [String]; let at: Double }

    /// lib/actions/lease.ts LeaseSnapshot, the fields the phone needs.
    struct Snapshot: Codable, Equatable {
        struct Terms: Codable, Equatable { let rentAmount: BigUInt; let depositAmount: BigUInt; let renter: String }
        struct Proposal: Codable, Equatable { let tenantRefund: BigUInt; let landlordClaim: BigUInt; let proposer: String; let nonce: Int }
        let address: String
        let status: String
        let terms: Terms
        let checkInHash: String
        let checkOutHash: String
        let proposal: Proposal
    }

    let chainId: Int
    let listing: Listing
    let owner: String
    let price: Price
    let rental: Rental?
    let creating: Creating?
    let lease: Snapshot?
    let drip: Drip?
    let me: Me?
    let presenterLocked: Bool?
}

/// GET /api/chain/index: every KeyScrow event on the chain (filtered per rental in the app).
struct ChainIndex: Codable {
    struct Event: Codable, Equatable, Identifiable {
        let address: String
        let name: String
        let args: [String: JSONValue]
        let txHash: String
        let blockNumber: BigUInt
        let logIndex: Int
        let timestamp: BigUInt
        var id: String { "\(txHash)-\(logIndex)" }
        var date: Date { Date(timeIntervalSince1970: timestamp.double) }
    }

    let chainId: Int
    let events: [Event]

    func events(of lease: String) -> [Event] {
        events.filter { EthAddress.same($0.address, lease) || (EthAddress.same($0.args["escrow"]?.string, lease) && $0.name == "LeaseCreated") }
    }
}

/// POST /api/settlement: the AI inspector's proposed split.
struct Inspection: Codable, Equatable {
    struct Memory: Codable, Equatable { let provider: String?; let recalled: [String]? }
    let tenantRefund: BigUInt
    let landlordClaim: BigUInt
    let reasons: [String]
    let confidence: Double
    let deposit: BigUInt
    let mock: Bool
    let provider: String?
    let reportHash: String
    let memory: Memory?
}

/// POST /api/evidence
struct EvidenceUpload: Codable { struct Item: Codable { let hash: String; let storage: String? }; let items: [Item]; let mock: Bool? }

/// Transaction receipt from eth_getTransactionReceipt (fields the app reads).
struct TxReceipt: Codable, Equatable {
    struct Log: Codable, Equatable { let address: String; let topics: [String]; let data: String }
    let transactionHash: String
    let status: String?
    let blockNumber: String?
    let logs: [Log]
    var succeeded: Bool { status == "0x1" }
}
