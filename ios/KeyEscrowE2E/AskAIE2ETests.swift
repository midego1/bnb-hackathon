import XCTest

/// Live Ask AI run against the server's assistant (its demo model or a real one, whichever the server runs): a
/// read, then an approval card signed on the phone (BSC testnet).
final class AskAIE2ETests: XCTestCase {
    func testAskAIReadAndApprove() {
        let app = XCUIApplication()
        app.launchArguments = ["-tab", "2", "-lang", "en", "-appearance", "light"]
        app.launch()
        let suggestion = app.buttons["Find my rental"]
        XCTAssertTrue(suggestion.waitForExistence(timeout: 20))
        suggestion.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'rental'")).element(boundBy: 1).waitForExistence(timeout: 60))

        let input = app.descendants(matching: .any)["ask-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("Create a rental for 3,400 baht a month with a 6,800 deposit for 0x8Ef4090Ac400622c2fE32a7244AA65Bbd1A6933C")
        // The send button is disabled while the assistant still answers the first question (a real model takes a
        // few seconds): wait for it, or the tap would be lost.
        let send = app.descendants(matching: .any)["ask-send"]
        let free = Date().addingTimeInterval(120)
        while !send.isEnabled && Date() < free { Thread.sleep(forTimeInterval: 1) }
        send.tap()
        let approve = app.descendants(matching: .any)["ask-approve"]
        XCTAssertTrue(approve.waitForExistence(timeout: 90), "approval card")
        approve.tap()
        XCTAssertTrue(app.descendants(matching: .any)["ask-approved"].waitForExistence(timeout: 180), "signed and sent")
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.lifetime = .keepAlways
        add(shot)
    }
}
