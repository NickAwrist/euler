import EulerAPI
import Foundation
import Testing
@testable import Euler

struct ModelProviderTests {
    private func model(
        _ id: String, _ provider: Euler_V1_ModelProvider, lab: String = "", favorite: Bool = false,
        configured: Bool = true, created: Int64? = nil
    ) -> Euler_V1_Model {
        var model = Euler_V1_Model()
        model.id = id
        model.name = id
        model.provider = provider
        model.lab = lab
        model.favorite = favorite
        model.configured = configured
        if id.hasPrefix("openrouter:") { model.route = String(id.dropFirst("openrouter:".count)) }
        if let created { model.created = .init(seconds: created) }
        return model
    }

    @Test func groupsByProviderAndLabWithConfiguredFavoritesFirst() {
        let groups = ModelProviderGroup.groups([
            model("qwen3:8b", .ollama, lab: "Ollama", favorite: true),
            model("openrouter:anthropic/claude", .openrouter, lab: "Anthropic"),
            model("openrouter:google/gemini", .openrouter, lab: "Google", favorite: true, configured: false),
            model("chatgpt:gpt", .chatgpt, lab: "OpenAI"),
        ])
        #expect(groups.map(\.name) == ["Favorites", "Anthropic", "ChatGPT", "Google", "Ollama"])
        #expect(groups[0].models.map(\.id) == ["qwen3:8b"])
        #expect(groups.map(\.icon) == [nil, .claude, .codex, .gemini, .ollama])
    }

    @Test func sortsFavoritesThenNewestThenName() {
        let group = ModelProviderGroup.groups([
            model("openrouter:openai/b", .openrouter, lab: "OpenAI", created: 1),
            model("openrouter:openai/a", .openrouter, lab: "OpenAI", created: 1),
            model("openrouter:openai/new", .openrouter, lab: "OpenAI", created: 5),
            model("openrouter:openai/star", .openrouter, lab: "OpenAI", favorite: true),
        ])[1]
        #expect(group.models.map(\.id) == ["openrouter:openai/star", "openrouter:openai/new", "openrouter:openai/a", "openrouter:openai/b"])
    }

    @Test func iconsForLabsWithoutALogoFallBackToInitials() {
        #expect(ProviderIconAsset.forModel(model("openrouter:x-ai/grok", .openrouter, lab: "xAI")) == .xai)
        #expect(ProviderIconAsset.forModel(model("openrouter:cohere/command", .openrouter, lab: "Cohere")) == nil)
        #expect(ProviderIconAsset.forModelID("openrouter:anthropic/claude-gone") == .claude)
        #expect(ProviderIconAsset.forModelID("chatgpt:gpt-gone") == .codex)
        #expect(ProviderIconAsset.forModelID("llama3:8b") == .ollama)
    }

    @Test func onlyUnconfiguredOpenRouterModelsNeedSetup() {
        #expect(model("openrouter:openai/gpt", .openrouter, configured: false).needsSetup)
        #expect(!model("chatgpt:gpt", .chatgpt, configured: false).needsSetup)
    }

    @Test func greetsByFirstNameButNotByEmail() {
        #expect(WelcomeGreeting.firstName("  Ada Lovelace ") == "Ada")
        #expect(WelcomeGreeting.firstName("ada@example.com") == nil)
        #expect(WelcomeGreeting.firstName("") == nil)
    }

    @Test @MainActor func opensOnTheDefaultQuestionThenChangesIt() {
        let first = WelcomeGreeting.next()
        let second = WelcomeGreeting.next()
        #expect(WelcomeGreeting.questions.contains(first.question))
        #expect(second.question != first.question)
    }
}
