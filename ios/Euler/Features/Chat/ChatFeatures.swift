import EulerAPI

/// A command a running feature adds to the composer, with the server's description.
struct RunCommand: Equatable {
    let name: ChatCommand
    let description: String
}

/// A panel a running feature draws for a chat, as the web's sidebar tabs.
struct ChatPanel: Identifiable, Equatable {
    enum Kind {
        case files
        case jobs
        case agents
    }

    let kind: Kind
    let label: String

    var id: Kind { kind }
}

/// What the running features add to a chat, as the web's useChatFeatures
/// derives it. Everything is off until the features load.
struct ChatFeatures {
    /// One per running feature that draws one, in the features' order.
    let panels: [ChatPanel]
    /// Each command once, in the features' order. A command this app cannot run is left out.
    let commands: [RunCommand]
    /// Whether `$` offers skills, which the Skills feature loads.
    let skills: Bool
    /// Whether `/` also offers MCP tools, which the MCP feature runs.
    let mcp: Bool
    /// Whether a reply's files can be opened.
    let files: Bool

    init(_ features: [Euler_V1_Feature]) {
        let running = features.filter { $0.enabled && !$0.hasUnavailableReason }
        panels = running.compactMap { feature in
            guard feature.hasSidebarTab, let kind = Self.panel(feature.id) else { return nil }
            return ChatPanel(kind: kind, label: feature.sidebarTab)
        }
        var commands: [RunCommand] = []
        for command in running.flatMap(\.commands) {
            guard let name = ChatCommand(rawValue: command.name), !commands.contains(where: { $0.name == name }) else { continue }
            commands.append(RunCommand(name: name, description: command.description_p))
        }
        self.commands = commands
        skills = running.contains { $0.id == .skills }
        mcp = running.contains { $0.id == .mcp }
        files = running.contains { $0.id == .files }
    }

    /// Whether a command lets the chat work somewhere else, which the Workspace sheet offers.
    var choosesWorkspace: Bool {
        commands.contains { $0.name != .workspace }
    }

    /// The panel each feature draws. A feature with none has no entry in the chat menu.
    private static func panel(_ id: Euler_V1_FeatureId) -> ChatPanel.Kind? {
        switch id {
        case .files: .files
        case .sandbox: .jobs
        case .subagents: .agents
        default: nil
        }
    }
}
