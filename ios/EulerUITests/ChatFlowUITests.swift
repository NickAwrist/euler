import XCTest

/// End-to-end flows against the scripted fixture backend
/// (tests/helpers/asyncFixture.ts in tool-permission mode), which needs no
/// real model. Start it with:
///   JOB_FIXTURE_PORT=5195 TOOL_PERMISSION_FIXTURE=1 bun tests/helpers/asyncFixture.ts
/// and set EULER_UI_SERVER when it runs elsewhere.
@MainActor
final class ChatFlowUITests: XCTestCase {
    private var server: URL {
        URL(string: ProcessInfo.processInfo.environment["EULER_UI_SERVER"] ?? "http://127.0.0.1:5195")!
    }

    private var app: XCUIApplication!
    private var user = ""

    override func setUp() async throws {
        continueAfterFailure = false
        user = UUID().uuidString.lowercased()
        // Every tool call asks, so the scripted bash call needs an approval.
        try await call("PreferenceService/PutPermissionRule", [
            "rule": [
                "id": UUID().uuidString.lowercased(),
                "tool": "*",
                "action": "ACTION_ASK",
                "condition": ["any": [String: String]()],
            ],
        ])
        try await call("PreferenceService/UpdatePreferences", [
            "settings": ["defaultModel": "openrouter:openai/gpt-5.6-terra"],
        ])
        app = XCUIApplication()
        app.launchArguments = ["-EulerResetIdentity", "YES"]
        app.launch()
        onboard()
    }

    private func onboard() {
        let address = app.textFields["Server address"]
        XCTAssertTrue(address.waitForExistence(timeout: 10))
        address.tap()
        address.typeText(server.absoluteString)
        let userID = app.textViews["User ID"].exists ? app.textViews["User ID"] : app.textFields["User ID"]
        userID.tap()
        userID.typeText(user)
        app.buttons["Connect"].tap()
        addUIInterruptionMonitor(withDescription: "Notifications") { alert in
            alert.buttons["Allow"].tap()
            return true
        }
        XCTAssertTrue(app.navigationBars["Chats"].waitForExistence(timeout: 10))
        app.tap()
    }

    func testSendsAMessageApprovesItsToolCallAndStreamsTheReply() {
        app.navigationBars["Chats"].buttons["New chat"].tap()
        let message = app.textViews["Message"].exists ? app.textViews["Message"] : app.textFields["Message"]
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("command:echo approved")
        app.buttons["Send message"].tap()

        let card = app.otherElements.matching(NSPredicate(format: "label ENDSWITH %@", "wants to run bash")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 15), "The approval card should appear above the composer")
        app.buttons["Allow once"].tap()

        let reply = app.staticTexts["The script is running in the background. You can keep chatting."]
        XCTAssertTrue(reply.waitForExistence(timeout: 20), "The reply should stream in after the approval")
        XCTAssertFalse(card.exists)
    }

    func testAttachesAPhotoFromTheLibrary() {
        app.navigationBars["Chats"].buttons["New chat"].tap()
        app.buttons["Attach images"].tap()
        app.buttons["Photo Library"].tap()
        // The system picker runs out of process; its photos are images labeled by date.
        let photo = app.images.matching(NSPredicate(format: "label BEGINSWITH %@", "Photo,")).firstMatch
        XCTAssertTrue(photo.waitForExistence(timeout: 10))
        // Remote picker cells don't report as hittable, so the tap goes to their center.
        photo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        app.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["Remove image"].waitForExistence(timeout: 10), "The photo should wait in the composer")
    }

    func testChangingTheThemeSavesItForTheWebToo() async throws {
        app.buttons["Settings"].tap()
        app.buttons["Appearance"].tap()
        app.buttons["Dracula"].tap()
        let deadline = Date.now.addingTimeInterval(10)
        var theme = ""
        while Date.now < deadline {
            let preferences = try await call("PreferenceService/GetPreferences", [:])
            theme = ((preferences["preferences"] as? [String: Any])?["appearance"] as? [String: Any])?["theme"] as? String ?? ""
            if theme == "THEME_DRACULA" { break }
            try await Task.sleep(for: .milliseconds(300))
        }
        XCTAssertEqual(theme, "THEME_DRACULA")
    }

    /// A Connect JSON call as this test's user.
    @discardableResult
    private func call(_ method: String, _ body: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: server.appending(path: "api/rpc/euler.v1.\(method)"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(user, forHTTPHeaderField: "x-euler-user-id")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            throw NSError(domain: "Fixture", code: status, userInfo: [NSLocalizedDescriptionKey: String(decoding: data, as: UTF8.self)])
        }
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}
