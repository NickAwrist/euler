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
        // The app opens on a new chat, with the chat list behind the Chats button.
        XCTAssertTrue(app.buttons["Chats"].waitForExistence(timeout: 10))
        app.tap()
    }

    private var message: XCUIElement {
        app.textViews["Message"].exists ? app.textViews["Message"] : app.textFields["Message"]
    }

    func testSendsAMessageApprovesItsToolCallAndStreamsTheReply() {
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

    func testTappingOffTheComposerPutsTheKeyboardAway() {
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.staticTexts["Type / for commands or $ to use a skill."].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
    }

    func testTheDrawerOpensAChatAndStartsANewOne() {
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("command:echo hello")
        app.buttons["Send message"].tap()
        XCTAssertTrue(app.buttons["New chat"].waitForExistence(timeout: 10), "A sent message opens its chat")

        app.buttons["New chat"].tap()
        XCTAssertTrue(app.staticTexts["Type / for commands or $ to use a skill."].waitForExistence(timeout: 5))

        app.buttons["Chats"].tap()
        let row = app.buttons
            .matching(identifier: "Drawer chat")
            // The label leads with the chat's status, such as "Agent working".
            .matching(NSPredicate(format: "label CONTAINS %@", "command:echo hello"))
            .firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "The drawer lists the new chat")
        row.tap()
        XCTAssertFalse(app.staticTexts["Type / for commands or $ to use a skill."].exists)
    }

    func testALongPressOnAReplyOpensItsTextForSelecting() {
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("command:echo approved")
        app.buttons["Send message"].tap()
        XCTAssertTrue(app.buttons["Allow once"].waitForExistence(timeout: 15))
        app.buttons["Allow once"].tap()

        let reply = app.staticTexts["The script is running in the background. You can keep chatting."]
        XCTAssertTrue(reply.waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["Message actions"].exists, "Actions are behind a long press, not a button")
        reply.press(forDuration: 1)
        app.buttons["Select text"].tap()
        let text = app.textViews["Message text"]
        XCTAssertTrue(text.waitForExistence(timeout: 5))
        XCTAssertEqual(text.value as? String, "The script is running in the background. You can keep chatting.")
    }

    func testAReplysTraceShowsTheCommandThatRan() {
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("command:echo approved")
        app.buttons["Send message"].tap()
        XCTAssertTrue(app.buttons["Allow once"].waitForExistence(timeout: 15))
        app.buttons["Allow once"].tap()

        let reply = app.staticTexts["The script is running in the background. You can keep chatting."]
        XCTAssertTrue(reply.waitForExistence(timeout: 20))
        reply.press(forDuration: 1)
        app.buttons["View trace"].tap()
        XCTAssertTrue(app.navigationBars["Execution Trace"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["bash"].exists)
        XCTAssertTrue(app.staticTexts["echo approved"].exists, "The command reads as typed, not as JSON")
        app.buttons["Close"].tap()
        XCTAssertTrue(app.navigationBars["Execution Trace"].waitForNonExistence(timeout: 5))
    }

    func testSwipingAChatAwayAsksFirstAndThenDeletesIt() {
        XCTAssertTrue(message.waitForExistence(timeout: 5))
        message.tap()
        message.typeText("command:echo hello")
        app.buttons["Send message"].tap()
        XCTAssertTrue(app.buttons["New chat"].waitForExistence(timeout: 10))

        app.buttons["Chats"].tap()
        let row = app.buttons.matching(identifier: "Drawer chat").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.swipeLeft()
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Delete this chat?"].waitForExistence(timeout: 5))
        app.buttons["Delete"].tap()
        XCTAssertTrue(row.waitForNonExistence(timeout: 10))
    }

    func testCustomizationOpensOnItsOwnAndASkillSaysWhatItIsMissing() {
        app.buttons["Chats"].tap()
        app.buttons["Customization"].tap()
        let bar = app.navigationBars["Customization"]
        XCTAssertTrue(bar.waitForExistence(timeout: 5))
        XCTAssertEqual(bar.buttons.count, 1, "Only Close: there is no Settings page to go back to")

        app.buttons["Skills"].tap()
        app.buttons["Add"].tap()
        app.buttons["New"].tap()
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Name is required\nDescription is required"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Instructions are required"].exists)
    }

    func testAddingAToolPermissionRuleKeepsSettingsOpen() {
        app.buttons["Chats"].tap()
        app.buttons["Settings"].tap()
        app.buttons["Tools"].tap()
        app.buttons["Add rule"].tap()
        let editor = app.navigationBars["New rule"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        // The editor used to open and then take Settings down with it.
        XCTAssertFalse(editor.waitForNonExistence(timeout: 3), "The rule editor should stay open")
        app.buttons["Tool, All tools"].tap()
        XCTAssertTrue(app.buttons["bash"].waitForExistence(timeout: 5), "The editor lists the server's tools")
        app.buttons["bash"].tap()
        app.switches["Match a field"].switches.firstMatch.tap()
        app.buttons["Field, Field"].tap()
        XCTAssertTrue(app.buttons["command"].waitForExistence(timeout: 5), "A tool's fields can be matched")
        app.buttons["command"].tap()
        let value = app.textFields["Value"]
        value.tap()
        value.typeText("rm")
        app.buttons["Save"].tap()
        XCTAssertTrue(editor.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars["Tools"].exists, "Saving a rule returns to Tools")
        XCTAssertTrue(app.staticTexts["Ask before bash"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["command is rm"].exists)
    }

    func testTappingOffAFormFieldPutsTheKeyboardAway() {
        app.buttons["Chats"].tap()
        app.buttons["Customization"].tap()
        app.buttons["Personalization"].tap()
        app.textFields["Enter your name"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.staticTexts["About you"].tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
    }

    func testChangingTheThemeSavesItForTheWebToo() async throws {
        app.buttons["Chats"].tap()
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
