import XCTest

/// Live end-to-end run on BSC testnet (real transactions, ~2 minutes): rent a demo scooter with the guest wallet,
/// anchor pickup + return photos, run the AI inspection, propose the split, let the demo shop accept, settle.
/// The scooter comes from E2E_SCOOTER (TEST_RUNNER_E2E_SCOOTER on the xcodebuild command line). A rental left half
/// way is carried on; a settled one is rented again.
/// Not part of `xcodebuild test -scheme KeyEscrow` (no network in unit tests); run with -scheme KeyEscrowE2E.
final class RentFlowE2ETests: XCTestCase {
    let app = XCUIApplication()

    private func el(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

    /// Waits for one of `ids` (the flow advances on its own as the chain confirms); fails on a flow error.
    /// One error is not the app's: the KeyScrow server answering that its chain node is unreachable ("try again in a
    /// moment"). Then the step's button (`after`) is tapped again, as a person would, up to three times.
    @discardableResult
    private func waitFor(_ ids: [String], after button: String? = nil, timeout: TimeInterval = 240) -> String {
        let end = Date().addingTimeInterval(timeout)
        var retries = 0
        while Date() < end {
            for id in ids where el(id).exists { return id }
            if el("flow-error").exists {
                let message = el("flow-error").label
                if message.contains("Try again in a moment"), retries < 3 {
                    retries += 1
                    Thread.sleep(forTimeInterval: 5)
                    // An action failed: tap its button again. A refresh failed: the app asks again by itself.
                    if let button, el(button).exists, el("flow-error").exists { tap(button) }
                    continue
                }
                XCTFail("flow error: \(message)"); return "error"
            }
            Thread.sleep(forTimeInterval: 1)
        }
        XCTFail("timed out waiting for \(ids)")
        return "timeout"
    }

    /// Keeps a screenshot of the step in the test result (xcrun xcresulttool export attachments ...).
    private func snap(_ name: String) {
        Thread.sleep(forTimeInterval: 0.6) // let the page settle
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
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
        for _ in 0..<10 where !scooter.isHittable { app.swipeUp() } // the cards are a screen tall each
        scooter.tap()
        tap("rent-it")

        var step = waitFor(["flow-money", "flow-rent", "flow-sample-check_in", "flow-sample-check_out", "flow-inspect", "flow-propose", "flow-shop-accept", "flow-settled"], timeout: 60)
        if step == "flow-settled" {
            // This wallet already rented this scooter and settled: start a new rental of it (the old escrow stays
            // on-chain), so the run is always a whole rental and never passes on yesterday's.
            tap("flow-again")
            step = waitFor(["flow-money", "flow-rent"], timeout: 60)
        }
        if step == "flow-money" { snap("1-money"); tap("flow-money"); step = waitFor(["flow-rent"], after: "flow-money") }
        if step == "flow-rent" { snap("2-pay"); tap("flow-rent"); step = waitFor(["flow-sample-check_in"], after: "flow-rent") }
        if step == "flow-sample-check_in" {
            tap("flow-sample-check_in"); snap("3-pickup"); tap("flow-save-check_in")
            step = waitFor(["flow-sample-check_out"], after: "flow-save-check_in")
        }
        if step == "flow-sample-check_out" {
            tap("flow-sample-check_out"); snap("4-return"); tap("flow-save-check_out")
            step = waitFor(["flow-inspect"], after: "flow-save-check_out")
        }
        if step == "flow-inspect" {
            snap("5-inspect")
            tap("flow-inspect")
            step = waitFor(["flow-propose"], after: "flow-inspect")
        }
        if step == "flow-propose" { snap("5-split"); tap("flow-propose"); step = waitFor(["flow-shop-accept"], after: "flow-propose") }
        if step == "flow-shop-accept" { snap("6-accept"); tap("flow-shop-accept"); step = waitFor(["flow-settled"], after: "flow-shop-accept") }
        XCTAssertEqual(step, "flow-settled")
        Thread.sleep(forTimeInterval: 1.5) // let the tick finish drawing
        snap("7-settled")
        app.swipeUp()
        snap("8-receipt")
    }
}
