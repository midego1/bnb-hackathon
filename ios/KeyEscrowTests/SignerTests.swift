import XCTest
@testable import KeyEscrow

/// Vectors produced with viem 2.58.6 (scripts/viem-vectors.mjs in ios/KeyEscrowTests/Fixtures/README.md).
/// The key is a well-known public test key (web3.js docs); it holds nothing and is never used by the app.
final class SignerTests: XCTestCase {
    let key = "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318"

    func testKeccak() {
        XCTAssertEqual(Keccak256.hash(Data()).hex0x, "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470")
        XCTAssertEqual(Keccak256.hash("abc").hex0x, "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45")
        // Longer than one 136-byte block.
        let long = String(repeating: "a", count: 300)
        XCTAssertEqual(Keccak256.hash(long).count, 32)
    }

    func testAddressFromKey() throws {
        let k = try EthKey(privateKey: Data(hex: key)!)
        XCTAssertEqual(k.address, "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23")
    }

    func testChecksum() {
        XCTAssertEqual(EthAddress.checksum("0xccc2a45748cd1f9f97e9108101d2d1e3d329a99c"), "0xcCC2a45748Cd1F9F97e9108101D2d1e3d329A99C")
        XCTAssertEqual(EthAddress.checksum("0x7af0035c254bc760231bccff3403a714611c35b1"), "0x7aF0035c254bC760231BCcFF3403A714611c35B1")
    }

    func testApproveTransactionMatchesViem() throws {
        let data = Data(hex: "0x095ea7b3000000000000000000000000ccc2a45748cd1f9f97e9108101d2d1e3d329a99c0000000000000000000000000000000000000000000000000000000011e1a300")!
        let tx = LegacyTransaction(nonce: 0, gasPrice: BigUInt(100_000_000), gas: 60000, to: "0x7aF0035c254bC760231BCcFF3403A714611c35B1", value: BigUInt(), data: data, chainId: 97)
        XCTAssertEqual(try tx.signingPayload().hex0x,
                       "0xf868808405f5e10082ea60947af0035c254bc760231bccff3403a714611c35b180b844095ea7b3000000000000000000000000ccc2a45748cd1f9f97e9108101d2d1e3d329a99c0000000000000000000000000000000000000000000000000000000011e1a300618080")
        let signed = try tx.signed(with: EthKey(privateKey: Data(hex: key)!))
        XCTAssertEqual(signed.hex0x,
                       "0xf8a9808405f5e10082ea60947af0035c254bc760231bccff3403a714611c35b180b844095ea7b3000000000000000000000000ccc2a45748cd1f9f97e9108101d2d1e3d329a99c0000000000000000000000000000000000000000000000000000000011e1a30081e6a018f63e8ca6965abbeef13804127022afe38e6398ea0aa6f120276f37a980debaa00bc739b073a65752ed8f8a2ac64cf2002cb21075f662f863a866c0c6aecbb456")
    }

    func testValueTransferMatchesViem() throws {
        let tx = LegacyTransaction(nonce: 7, gasPrice: BigUInt(1_000_000_000), gas: 21000, to: "0x8Ef4090Ac400622c2fE32a7244AA65Bbd1A6933C", value: BigUInt("400000000000000")!, data: Data(), chainId: 97)
        let signed = try tx.signed(with: EthKey(privateKey: Data(hex: key)!))
        XCTAssertEqual(signed.hex0x,
                       "0xf86b07843b9aca00825208948ef4090ac400622c2fe32a7244aa65bbd1a6933c87016bcc41e900008081e5a02cff439796c340af0f690bb30c21c8b05863ae4ccf67f7ddddebb757dc60168da05debbe8df8dae56f4aafef6481f041b731ae2f1be9bb6e62a7a700951995fb61")
    }

    func testRefusesOtherChains() throws {
        let k = try EthKey(privateKey: Data(hex: key)!)
        for id in [1, 56, 5611, 31337] {
            let tx = LegacyTransaction(nonce: 0, gasPrice: BigUInt(1), gas: 21000, to: k.address, value: BigUInt(), data: Data(), chainId: id)
            XCTAssertThrowsError(try tx.signed(with: k)) { XCTAssertEqual($0 as? EthError, .wrongChain(id)) }
        }
    }

    func testFaucetCalldataMatchesViem() throws {
        XCTAssertEqual(try ABI.faucet(to: "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23", amount: BigUInt(1_000_000_000)).hex0x,
                       "0x7b56c2b20000000000000000000000002c7536e3605d9c16a7a3d7b1898e529396a65c23000000000000000000000000000000000000000000000000000000003b9aca00")
    }

    func testRLP() {
        XCTAssertEqual(RLP.bytes(Data()).encoded.hex, "80")
        XCTAssertEqual(RLP.bytes(Data([0x7f])).encoded.hex, "7f")
        XCTAssertEqual(RLP.bytes(Data([0x80])).encoded.hex, "8180")
        XCTAssertEqual(RLP.list([]).encoded.hex, "c0")
        XCTAssertEqual(RLP.bytes(Data("dog".utf8)).encoded.hex, "83646f67")
        XCTAssertEqual(RLP.bytes(Data(repeating: 0x61, count: 56)).encoded.prefix(2).hex, "b838")
    }

    func testBigUInt() {
        let big = BigUInt("115792089237316195423570985008687907853269984665640564039457584007913129639935")!
        XCTAssertEqual(big.description, "115792089237316195423570985008687907853269984665640564039457584007913129639935")
        XCTAssertEqual(big.bytes.count, 32)
        XCTAssertEqual(BigUInt(hex: "0x5f5e100"), BigUInt(100_000_000))
        XCTAssertEqual(BigUInt(hex: "0x0"), BigUInt())
        XCTAssertEqual(BigUInt(100).hexQuantity, "0x64")
        XCTAssertEqual(BigUInt().hexQuantity, "0x0")
        XCTAssertEqual(BigUInt(5) - BigUInt(7), BigUInt())
        XCTAssertEqual((BigUInt("4294967296")! - BigUInt(1)).description, "4294967295")
        XCTAssertNil(BigUInt("12a"))
    }
}
