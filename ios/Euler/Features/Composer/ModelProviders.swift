import EulerAPI
import SwiftUI

/// Models grouped as the web's model picker groups them: Ollama, ChatGPT, and
/// one group per OpenRouter lab. A port of ui/components/modelProviders.ts.
struct ModelProviderGroup: Identifiable {
    let id: String
    let name: String
    /// An asset in Assets.xcassets/Providers, copied from the web's public/icons.
    let icon: ProviderIconAsset?
    var models: [Euler_V1_Model]

    static let favoritesID = "favorites"

    /// Favorites (configured only) first, then each provider, by name.
    static func groups(_ models: [Euler_V1_Model]) -> [ModelProviderGroup] {
        var groups: [String: ModelProviderGroup] = [:]
        for model in models {
            let id = groupID(model)
            if groups[id] == nil {
                groups[id] = ModelProviderGroup(id: id, name: groupName(model), icon: .forModel(model), models: [])
            }
            groups[id]?.models.append(model)
        }
        let providers = groups.values
            .map { group in
                var group = group
                group.models.sort(by: Euler_V1_Model.precedes)
                return group
            }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        let favorites = ModelProviderGroup(
            id: favoritesID,
            name: "Favorites",
            icon: nil,
            models: models.filter { $0.favorite && $0.configured }.sorted(by: Euler_V1_Model.precedes)
        )
        return [favorites] + providers
    }

    private static func groupID(_ model: Euler_V1_Model) -> String {
        switch model.provider {
        case .ollama: "ollama"
        case .chatgpt: "chatgpt"
        default: "openrouter:\(model.hasPublisherID ? model.publisherID : model.routeOrganization)"
        }
    }

    private static func groupName(_ model: Euler_V1_Model) -> String {
        switch model.provider {
        case .ollama: "Ollama"
        case .chatgpt: "ChatGPT"
        default: model.lab.trimmingCharacters(in: .whitespaces).isEmpty ? "OpenRouter" : model.lab.trimmingCharacters(in: .whitespaces)
        }
    }
}

/// A provider's logo. Monochrome logos are template images that take the
/// foreground color, as the web inverts them (see scripts/ios-icons.ts).
enum ProviderIconAsset: String {
    case claude, codex, deepseek, gemini, meta, mistral, moonshot, ollama, openai, openrouter, qwen, xai

    /// Major labs by route organization or normalized lab name.
    private static let labs: [String: ProviderIconAsset] = [
        "anthropic": .claude, "openai": .openai, "chatgpt": .codex, "google": .gemini, "deepseek": .deepseek,
        "xai": .xai, "x-ai": .xai, "moonshot": .moonshot, "moonshotai": .moonshot, "meta": .meta,
        "meta-llama": .meta, "mistral": .mistral, "mistralai": .mistral, "qwen": .qwen,
    ]

    static func forModel(_ model: Euler_V1_Model) -> ProviderIconAsset? {
        switch model.provider {
        case .ollama: return .ollama
        case .chatgpt: return .codex
        default:
            let lab = model.lab.lowercased().filter { $0.isLetter || $0.isNumber || $0 == "-" }
            return labs[model.routeOrganization.lowercased()] ?? labs[lab]
        }
    }

    /// The icon for a saved model ID, when the catalog no longer lists the model.
    static func forModelID(_ id: String) -> ProviderIconAsset? {
        if id.hasPrefix("chatgpt:") { return .codex }
        guard id.hasPrefix("openrouter:") else { return .ollama }
        let organization = id.dropFirst("openrouter:".count).split(separator: "/").first.map(String.init) ?? ""
        return labs[organization.replacingOccurrences(of: "~", with: "").lowercased()]
    }
}

/// A provider's logo at a fixed size, or its initials when it has none.
struct ProviderIcon: View {
    let icon: ProviderIconAsset?
    var name = ""
    var size: CGFloat = 18
    /// The color of a monochrome logo; the theme's foreground unless set.
    var color: Color?
    @Environment(\.palette) private var palette

    var body: some View {
        Group {
            if let icon {
                Image("provider-\(icon.rawValue)")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(color ?? palette.foreground)
            } else {
                Text(name.prefix(2).uppercased())
                    .font(.system(size: size * 0.55, weight: .semibold))
                    .foregroundStyle(palette.muted)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

extension Euler_V1_Model {
    /// A model ID without its catalog prefix, for display, as the web's modelRoute.
    static func displayRoute(_ id: String) -> String {
        id.replacing(/^(openrouter|chatgpt):/, with: "")
    }

    /// The OpenRouter route's organization, such as "anthropic".
    var routeOrganization: String {
        let route = hasRoute ? route : id.replacingOccurrences(of: "openrouter:", with: "")
        return route.replacingOccurrences(of: "~", with: "").split(separator: "/").first.map(String.init) ?? ""
    }

    /// Favorites first, then newest additions, then by name; unknown dates sort last.
    static func precedes(_ a: Euler_V1_Model, _ b: Euler_V1_Model) -> Bool {
        if a.favorite != b.favorite { return a.favorite }
        let aCreated = a.hasCreated ? a.created.seconds : 0
        let bCreated = b.hasCreated ? b.created.seconds : 0
        if aCreated != bCreated { return aCreated > bCreated }
        return a.name.localizedCompare(b.name) == .orderedAscending
    }

    /// Only OpenRouter models need setup before they can be picked.
    var needsSetup: Bool {
        provider == .openrouter && !configured
    }

    /// Vision, tools and thinking, as the web's capability icons show them.
    var capabilities: [(label: String, symbol: String)] {
        var result: [(String, String)] = []
        if acceptsImages { result.append(("Vision", "eye")) }
        if supportsTools { result.append(("Tools", "wrench")) }
        if hasReasoning { result.append(("Thinking", "brain")) }
        return result
    }

    /// Setup, availability and context, as the web's picker details them.
    var pickerDetails: String {
        var details: [String] = []
        let unverified = availability == .unverified
        if !configured { details.append("Setup required") }
        if unverified { details.append("Availability unverified") }
        if hasContextLength {
            details.append("\(contextLength.formatted(.number.notation(.compactName))) context")
        }
        // Unverified models carry placeholder capabilities, so don't claim any.
        if !unverified, capabilities.isEmpty { details.append("Chat only") }
        return details.joined(separator: " · ")
    }
}
