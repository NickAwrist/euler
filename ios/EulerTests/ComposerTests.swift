import EulerAPI
import Foundation
import Testing
@testable import Euler

struct ComposerTokenTests {
    private func token(_ text: String) -> ComposerToken? {
        ComposerToken.find(in: text, caret: text.endIndex)
    }

    @Test func findsSkillsFilesToolsAndCommands() {
        #expect(token("Use $rev")?.kind == .skill)
        #expect(token("Use $rev")?.query == "rev")
        #expect(token("Read @src/ma")?.kind == .file)
        #expect(token("Read @src/ma")?.query == "src/ma")
        #expect(token("Then /ech")?.kind == .tool)
        #expect(token("/dir")?.kind == .tool)
        #expect(token("nick@example.com") == nil)
        #expect(token("price$5")?.kind != .skill)
    }

    @Test func completionReplacesTheTokenAndAddsASpaceAtTheEnd() {
        let text = "Check @src"
        let found = token(text)!
        let (completed, caret) = found.complete(text, with: "@src/server.ts")
        #expect(completed == "Check @src/server.ts ")
        #expect(caret == completed.endIndex)
    }

    @Test func pathsWithSpacesAreQuoted() {
        #expect(ComposerToken.fileReference("docs/notes one.md") == #"@"docs/notes one.md""#)
        #expect(ComposerToken.fileReference("src/index.ts") == "@src/index.ts")
    }
}

/// A port of ui/lib/thinkingLevel.ts.
struct ThinkingOptionTests {
    private func reasoning(efforts: [String] = [], mandatory: Bool = false, enabled: Bool = true, defaultEffort: String? = nil) -> Euler_V1_ModelReasoning {
        var reasoning = Euler_V1_ModelReasoning()
        reasoning.supportedEfforts = efforts
        reasoning.mandatory = mandatory
        reasoning.defaultEnabled = enabled
        if let defaultEffort { reasoning.defaultEffort = defaultEffort }
        return reasoning
    }

    @Test func binaryModelsOfferOffAndOn() {
        let options = ThinkingOption.options(for: reasoning())
        #expect(options.map(\.value) == ["off", "on"])
        #expect(ThinkingOption.resolve(options, reasoning: reasoning(), preference: nil) == "on")
        #expect(ThinkingOption.resolve(options, reasoning: reasoning(enabled: false), preference: nil) == "off")
    }

    @Test func effortsSortByLevelWithASynthesizedOff() {
        let model = reasoning(efforts: ["high", "low", "medium"], defaultEffort: "medium")
        let options = ThinkingOption.options(for: model)
        #expect(options.map(\.value) == ["off", "low", "medium", "high"])
        #expect(ThinkingOption.resolve(options, reasoning: model, preference: nil) == "medium")
        // A preference saved on another model matches by tier.
        #expect(ThinkingOption.resolve(options, reasoning: model, preference: "none") == "off")
    }

    @Test func mandatoryReasoningWithoutTiersHasNoChoice() {
        #expect(ThinkingOption.options(for: reasoning(mandatory: true)).isEmpty)
    }
}

@MainActor
struct ComposerDraftTests {
    @Test func aFailedSendKeepsTheDraft() async {
        let draft = ComposerDraft()
        draft.text = "Hello"
        let backend = Backend(baseURL: URL(string: "http://127.0.0.1:9")!, userID: "u")
        struct Failure: Error {}
        let sent = await draft.submit(sessionID: "chat", backend: backend) { _, _ in throw Failure() }
        #expect(!sent)
        #expect(draft.text == "Hello")
        #expect(draft.error != nil)
    }

    @Test func aSuccessfulSendKeepsTextTypedMeanwhile() async {
        let draft = ComposerDraft()
        draft.text = "First"
        let backend = Backend(baseURL: URL(string: "http://127.0.0.1:9")!, userID: "u")
        var sentContent = ""
        let sent = await draft.submit(sessionID: "chat", backend: backend) { content, _ in
            sentContent = content
            draft.text = "Second"
        }
        #expect(sent)
        #expect(sentContent == "First")
        #expect(draft.text == "Second")
    }
}

struct SkillImportTests {
    @Test func readsFrontmatterAndBody() {
        let fields = SkillFields.parse("""
        ---
        name: Release Notes!
        description: >
          Write release
          notes.
        disable-model-invocation: true
        ---
        # Steps

        Do it.
        """)
        #expect(fields.name == "release-notes")
        #expect(fields.description == "Write release notes.")
        #expect(fields.instructions == "# Steps\n\nDo it.")
        #expect(fields.userInvocable)
        #expect(fields.disableModelInvocation)
    }

    @Test func textWithoutFrontmatterIsAllInstructions() {
        #expect(SkillFields.parse("Just do it.").instructions == "Just do it.")
    }
}

struct SkillFieldsTests {
    @Test func namesWhatEachFieldIsMissing() {
        #expect(SkillFields().problems == .init(
            name: "Name is required",
            description: "Description is required",
            instructions: "Instructions are required"
        ))
        var fields = SkillFields()
        fields.name = "release-notes"
        fields.description = "  \n"
        fields.instructions = "Do it."
        #expect(fields.problems == .init(description: "Description is required"))
        fields.description = "Write release notes."
        #expect(fields.problems.isEmpty)
    }

    @Test func holdsFieldsToTheServersLengths() {
        var fields = SkillFields()
        fields.name = String(repeating: "a", count: 65)
        fields.description = String(repeating: "b", count: 501)
        fields.instructions = "Do it."
        #expect(fields.problems == .init(
            name: "Name must be 64 characters or fewer",
            description: "Description must be 500 characters or fewer"
        ))
    }
}

struct IdentityTests {
    @Test func normalizesServerAddresses() {
        #expect(Identity.serverURL(from: "spaceheater:3200")?.absoluteString == "http://spaceheater:3200")
        #expect(Identity.serverURL(from: "https://euler.example/path?x")?.absoluteString == "https://euler.example")
        #expect(Identity.serverURL(from: "ftp://x") == nil)
    }

    @Test func acceptsOnlyUUIDs() {
        #expect(Identity.isValidUserID("463f839e-8eab-4b37-89ca-7db9452280a6"))
        #expect(!Identity.isValidUserID("draft"))
    }
}
