import XCTest

/// Live Ask AI run against the server's assistant (its demo model or a real one, whichever the server runs): a
/// read, then an approval card signed on the phone (BSC testnet).
final class AskAIE2ETests: XCTestCase {
    let app = XCUIApplication()

    private func el(_ id: String) -> XCUIElement { app.descendants(matching: .any)[id] }

    /// Types into the composer and sends. The send button is disabled while the assistant still answers (a real
    /// model takes a few seconds): wait for it, or the tap would be lost.
    private func say(_ text: String) {
        let input = el("ask-input")
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText(text)
        let send = el("ask-send")
        let free = Date().addingTimeInterval(150)
        while !send.isEnabled && Date() < free { Thread.sleep(forTimeInterval: 1) }
        send.tap()
    }

    /// Waits for the approval card. False when the assistant went quiet without one (a real model may ask a question
    /// back instead of preparing the change).
    private func approvalArrives(within timeout: TimeInterval) -> Bool {
        let end = Date().addingTimeInterval(timeout)
        var quiet = 0
        while Date() < end {
            if el("ask-approve").exists { return true }
            quiet = app.staticTexts["Thinking…"].exists ? 0 : quiet + 1
            if quiet >= 6 { return el("ask-approve").exists }
            Thread.sleep(forTimeInterval: 1)
        }
        return el("ask-approve").exists
    }

    func testAskAIReadAndApprove() {
        app.launchArguments = ["-tab", "2", "-lang", "en", "-appearance", "light"]
        app.launch()
        let suggestion = app.buttons["Find my rental"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 20))
        suggestion.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'rental'")).element(boundBy: 1).waitForExistence(timeout: 60))

        // Everything the rental needs is in the request, so a model has nothing to ask back.
        say("Create a rental with a term of 1 month: rent 3,400 baht a month, deposit 6,800 baht, renter 0x8Ef4090Ac400622c2fE32a7244AA65Bbd1A6933C. Use the default reply and dispute windows.")
        if !approvalArrives(within: 120) {
            say("Yes: 1 month, the default windows. Please prepare it now.")
        }
        let approve = el("ask-approve")
        XCTAssertTrue(approve.waitForExistence(timeout: 120), "approval card")
        approve.tap()
        XCTAssertTrue(el("ask-approved").waitForExistence(timeout: 180), "signed and sent")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "ask-approved"
        shot.lifetime = .keepAlways
        add(shot)
    }
}
