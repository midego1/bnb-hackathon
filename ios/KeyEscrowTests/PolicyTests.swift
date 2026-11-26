import XCTest
@testable import KeyEscrow

/// TxPolicy decides from the calldata; `isEscrow` stands in for the on-chain EscrowFactory.isLease read.
final class PolicyTests: XCTestCase {
    let me = "0x2c7536E3605D9C16a7a3D7b1898e529396a65c23"
    let escrow = "0xcCC2a45748Cd1F9F97e9108101D2d1e3d329A99C"
    let attacker = "0x000000000000000000000000000000000000dEaD"
    lazy var isEscrow: (String) async -> Bool = { [escrow] in EthAddress.same($0, escrow) }

    func call(_ sig: String, _ words: Data...) -> Data { words.reduce(ABI.selector(sig), +) }

    func allowed(_ to: String, _ data: Data) async -> Bool {
        do { try await TxPolicy.check(to: to, data: data, signer: me, isEscrow: isEscrow); return true } catch { return false }
    }

    func testApproveOnlyToEscrowAndCapped() async throws {
        let ok = call("approve(address,uint256)", try ABI.address(escrow), BigUInt(300_000_000).word)
        let bad = call("approve(address,uint256)", try ABI.address(attacker), BigUInt(300_000_000).word)
        let huge = call("approve(address,uint256)", try ABI.address(escrow), BigUInt("115792089237316195423570985008687907853269984665640564039457584007913129639935")!.word)
        let ok1 = await allowed(TxSender.token, ok), bad1 = await allowed(TxSender.token, bad), huge1 = await allowed(TxSender.token, huge)
        XCTAssertTrue(ok1); XCTAssertFalse(bad1); XCTAssertFalse(huge1)
        // The real prepare_fund approve step passes.
        let fund = try JSONDecoder().decode(Prepared.self, from: Data(contentsOf: Bundle(for: PolicyTests.self).url(forResource: "prepare_fund", withExtension: "json")!))
        for step in fund.steps {
            let pass = await allowed(step.to, Data(hex: step.data)!)
            XCTAssertTrue(pass, step.description)
        }
    }

    func testTransfersAndForeignContractsRefused() async throws {
        let t = await allowed(TxSender.token, call("transfer(address,uint256)", try ABI.address(attacker), BigUInt(1).word))
        let tf = await allowed(TxSender.token, call("transferFrom(address,address,uint256)", try ABI.address(me), try ABI.address(attacker), BigUInt(1).word))
        let foreign = await allowed(attacker, call("fund()"))
        let notAction = await allowed(escrow, call("transfer(address,uint256)", try ABI.address(attacker), BigUInt(1).word))
        XCTAssertFalse(t); XCTAssertFalse(tf); XCTAssertFalse(foreign); XCTAssertFalse(notAction)
    }

    func testFaucetOnlyToSelf() async throws {
        let mine = await allowed(TxSender.token, try ABI.faucet(to: me, amount: BigUInt(1)))
        let theirs = await allowed(TxSender.token, try ABI.faucet(to: attacker, amount: BigUInt(1)))
        XCTAssertTrue(mine); XCTAssertFalse(theirs)
    }

    func testEscrowActionsAndFactory() async throws {
        for sig in ["fund()", "releaseRent()", "dispute()", "claimTimeout()"] {
            let ok = await allowed(escrow, call(sig))
            XCTAssertTrue(ok, sig)
        }
        let create = await allowed(TxSender.factory, call("createLease(\(TxPolicy.lease))", try ABI.address(me)))
        let other = await allowed(TxSender.factory, call("setFee(uint256)", BigUInt(1).word))
        XCTAssertTrue(create); XCTAssertFalse(other)
        XCTAssertEqual(TxPolicy.propose.hex, ABI.selector("propose(uint256,bytes32)").hex)
    }
}
