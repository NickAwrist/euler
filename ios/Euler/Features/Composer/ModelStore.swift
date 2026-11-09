import EulerAPI
import Foundation
import Observation

/// The model catalog the composer picks from, and the thinking level the user
/// chose per model on this phone (the web keeps its own per browser).
@Observable
final class ModelStore {
    private(set) var models: [Euler_V1_Model] = []
    private(set) var providers = Euler_V1_ProviderStates()
    private(set) var loaded = false
    private(set) var error: String?
    private(set) var thinking: [String: String]

    @ObservationIgnored private let client: any Euler_V1_ModelServiceClientInterface
    @ObservationIgnored private let thinkingKey: String

    init(client: any Euler_V1_ModelServiceClientInterface, userID: String) {
        self.client = client
        thinkingKey = "EulerThinking.\(userID)"
        thinking = UserDefaults.standard.dictionary(forKey: thinkingKey) as? [String: String] ?? [:]
    }

    func load() async {
        do {
            let response = try await client.listModels(request: .init(), headers: [:]).value()
            models = response.models
            providers = response.providers
            error = nil
        } catch {
            self.error = error.displayMessage
        }
        loaded = true
    }

    func model(_ id: String) -> Euler_V1_Model? {
        models.first { $0.id == id }
    }

    /// Models the composer can send to, favorites first within each provider.
    var selectable: [Euler_V1_Model] {
        models.filter { $0.configured && $0.availability != .unavailable }
    }

    func setFavorite(_ model: Euler_V1_Model, _ favorite: Bool) async throws {
        var request = Euler_V1_SetFavoriteRequest()
        request.provider = model.provider
        // The server takes each provider's own ID: the raw OpenRouter route.
        request.modelID = model.hasRoute ? model.route : model.id
        request.favorite = favorite
        // Shown at once, as on the web, and put back if the server refuses.
        let index = models.firstIndex { $0.id == model.id }
        if let index { models[index].favorite = favorite }
        do {
            _ = try await client.setFavorite(request: request, headers: [:]).value()
        } catch {
            if let index, models.indices.contains(index), models[index].id == model.id { models[index].favorite = !favorite }
            throw error
        }
    }

    // MARK: Thinking

    func thinkingOptions(for model: Euler_V1_Model?) -> [ThinkingOption] {
        guard let model, model.hasReasoning else { return [] }
        return ThinkingOption.options(for: model.reasoning)
    }

    /// The effort a turn sends: the user's saved choice, else the model's default.
    func effort(for model: Euler_V1_Model?) -> String? {
        guard let model, model.hasReasoning else { return nil }
        let options = ThinkingOption.options(for: model.reasoning)
        return ThinkingOption.resolve(options, reasoning: model.reasoning, preference: thinking[model.id])
    }

    func setEffort(_ effort: String, for model: Euler_V1_Model) {
        thinking[model.id] = effort
        UserDefaults.standard.set(thinking, forKey: thinkingKey)
    }
}

/// One thinking level a model offers. A port of ui/lib/thinkingLevel.ts.
struct ThinkingOption: Hashable, Identifiable {
    var value: String
    var label: String
    var level: Int
    var isDefault: Bool

    var id: String { value }

    enum Tier: Int {
        case off, low, medium, high, xhigh, max
    }

    private static let known: [String: (label: String, level: Int, tier: Tier)] = [
        "off": ("Off", 0, .off),
        "none": ("Off", 0, .off),
        "minimal": ("Minimal", 1, .low),
        "low": ("Low", 2, .low),
        "medium": ("Medium", 3, .medium),
        "on": ("On", 3, .medium),
        "high": ("High", 4, .high),
        "xhigh": ("Extra High", 5, .xhigh),
        "max": ("Maximum", 6, .max),
    ]

    static func tier(of effort: String) -> Tier {
        known[effort.lowercased()]?.tier ?? .off
    }

    var tier: Tier { Self.known[value.lowercased()]?.tier ?? .medium }

    static func options(for reasoning: Euler_V1_ModelReasoning) -> [ThinkingOption] {
        let supported = reasoning.supportedEfforts
        if reasoning.mandatory, supported.isEmpty { return [] }
        if supported.isEmpty {
            return [
                ThinkingOption(value: "off", label: "Off", level: 0, isDefault: !reasoning.defaultEnabled),
                ThinkingOption(value: "on", label: "On", level: 3, isDefault: reasoning.defaultEnabled),
            ]
        }
        var options: [ThinkingOption] = []
        let hasOff = supported.contains { ["none", "off"].contains($0.lowercased()) }
        if !reasoning.mandatory, !hasOff {
            options.append(ThinkingOption(value: "off", label: "Off", level: 0, isDefault: !reasoning.defaultEnabled))
        }
        let defaultEffort = reasoning.hasDefaultEffort ? reasoning.defaultEffort.lowercased() : nil
        for effort in supported {
            let key = effort.lowercased()
            let config = known[key] ?? (effort.prefix(1).uppercased() + effort.dropFirst(), 3, .medium)
            options.append(ThinkingOption(
                value: key == "off" ? "off" : effort,
                label: config.label,
                level: config.level,
                isDefault: defaultEffort == key || (defaultEffort == nil && reasoning.defaultEnabled && key == "high")
            ))
        }
        return options.sorted { $0.level < $1.level }
    }

    /// The effective effort: the preference, matched exactly or by tier, else
    /// the model's default, else off when disabled by default, else the first default.
    static func resolve(_ options: [ThinkingOption], reasoning: Euler_V1_ModelReasoning, preference: String?) -> String? {
        guard options.count > 1 else { return nil }
        func match(_ effort: String) -> String? {
            options.first { $0.value.lowercased() == effort.lowercased() }?.value
                ?? options.first { tier(of: $0.value) == tier(of: effort) }?.value
        }
        if let preference, let matched = match(preference) { return matched }
        if reasoning.hasDefaultEffort, let matched = match(reasoning.defaultEffort) { return matched }
        if !reasoning.mandatory, !reasoning.defaultEnabled {
            return options.first { tier(of: $0.value) == .off }?.value ?? "off"
        }
        return (options.first(where: \.isDefault) ?? options.first { $0.level > 0 } ?? options.first)?.value
    }
}

extension Euler_V1_Model {
    var acceptsImages: Bool {
        inputCapabilities.contains(.image)
    }
}
