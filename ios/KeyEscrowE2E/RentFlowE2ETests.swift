import XCTest

/// Live end-to-end run on BSC testnet (real transactions, ~3-5 minutes): rent a demo scooter with the guest wallet,
/// anchor pickup + return photos, run the AI inspection, propose the split, let the demo shop accept, settle.
/// Not part of `xcodebuild test -scheme KeyEscrow` (no network in unit tests); run with -scheme KeyEscrowE2E.
final class RentFlowE2ETests: XCTestCase {
    let app = XCUIApplication()

    private func el(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

    /// Waits for one of `ids` (the flow advances on its own as the chain confirms); fails on a flow error.
    @discardableResult
    private func waitFor(_ ids: [String], timeout: TimeInterval = 240) -> String {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            for id in ids where el(id).exists { return id }
            if el("flow-error").exists { XCTFail("flow error: \(el("flow-error").label)"); return "error" }
            Thread.sleep(forTimeInterval: 1)
        }
        XCTFail("timed out waiting for \(ids)")
        return "timeout"
    }

    private func tap(_ id: String) {
        let b = el(id)
        XCTAssertTrue(b.waitForExistence(timeout: 30), id)
        for _ in 0..<6 where !b.isHittable { app.swipeUp() }
        let end = Date().addingTimeInterval(180) // disabled while the chain catches up (e.g. photos not indexed yet)
        while !b.isEnabled && Date() < end { Thread.sleep(forTimeInterval: 1) }
        b.tap()
    }

    func testRentDemoScooterEndToEnd() {
        app.launchArguments = ["-tab", "0", "-lang", "en", "-appearance", "light"]
        app.launch()
        let scooter = app.staticTexts[ProcessInfo.processInfo.environment["E2E_SCOOTER"] ?? "Honda Scoopy-i"]
        XCTAssertTrue(scooter.waitForExistence(timeout: 30))
        for _ in 0..<4 where !scooter.isHittable { app.swipeUp() }
        scooter.tap()
        tap("rent-it")

        var step = waitFor(["flow-money", "flow-rent", "flow-sample-check_in", "flow-sample-check_out", "flow-inspect", "flow-propose", "flow-shop-accept", "flow-settled"], timeout: 60)
        if step == "flow-money" { tap("flow-money"); step = waitFor(["flow-rent"]) }
        if step == "flow-rent" { tap("flow-rent"); step = waitFor(["flow-sample-check_in"]) }
        if step == "flow-sample-check_in" {
            tap("flow-sample-check_in"); tap("flow-save-check_in")
            step = waitFor(["flow-sample-check_out"])
        }
        if step == "flow-sample-check_out" {
            tap("flow-sample-check_out"); tap("flow-save-check_out")
            step = waitFor(["flow-inspect"])
        }
        if step == "flow-inspect" {
            tap("flow-inspect")
            step = waitFor(["flow-propose"])
        }
        if step == "flow-propose" { tap("flow-propose"); step = waitFor(["flow-shop-accept"]) }
        if step == "flow-shop-accept" { tap("flow-shop-accept"); step = waitFor(["flow-settled"]) }
        XCTAssertEqual(step, "flow-settled")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.lifetime = .keepAlways
        add(shot)
    }
}
