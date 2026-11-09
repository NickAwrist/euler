import EulerAPI
import SwiftUI

/// Skills and MCP tools the composer suggests, loaded once per session and
/// refreshed when Customization changes them.
@Observable
final class CompletionSources {
    private(set) var skills: [Euler_V1_Skill] = []
    private(set) var tools: [Euler_V1_McpTool] = []
    @ObservationIgnored private let backend: Backend
    @ObservationIgnored private var loaded = false

    init(backend: Backend) {
        self.backend = backend
    }

    func loadIfNeeded() async {
        guard !loaded else { return }
        loaded = true
        await reload()
    }

    func reload() async {
        async let skills = backend.skills.listSkills(request: .init(), headers: [:]).value()
        async let tools = backend.mcpServers.listTools(request: .init(), headers: [:]).value()
        if let skills = try? await skills { self.skills = skills.skills }
        if let tools = try? await tools { self.tools = tools.tools }
    }
}

/// The suggestion list above the composer for the token the caret is in.
struct ComposerSuggestions: View {
    let target: ComposerTarget
    let token: ComposerToken?
    let complete: ((text: String, caret: String.Index)) -> Void
    let run: (ChatCommand) -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var files: [Euler_V1_WorkspaceFile] = []
    @State private var filesFailed = false

    private struct Suggestion: Identifiable {
        let id: String
        let label: String
        let detail: String
        let icon: String
        let select: () -> Void
    }

    var body: some View {
        let suggestions = self.suggestions
        Group {
            if !suggestions.isEmpty {
                VStack(spacing: 0) {
                    ForEach(suggestions) { suggestion in
                        Button(action: suggestion.select) {
                            HStack(spacing: 10) {
                                Image(systemName: suggestion.icon).foregroundStyle(palette.muted).frame(width: 20)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(suggestion.label).font(.subheadline.monospaced()).lineLimit(1)
                                    if !suggestion.detail.isEmpty {
                                        Text(suggestion.detail).font(.caption).foregroundStyle(palette.muted).lineLimit(1)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .background(palette.surface, in: .rect(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(palette.borderSubtle))
            } else if token?.kind == .file {
                Text(filesFailed ? "Could not load workspace files" : "No matching files")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(palette.surface, in: .rect(cornerRadius: 14))
            }
        }
        .task { await session.completions.loadIfNeeded() }
        .task(id: token?.kind == .file ? token?.query : nil) { await loadFiles() }
    }

    private var suggestions: [Suggestion] {
        guard let token else { return [] }
        let text = target.draft.text
        switch token.kind {
        case .skill:
            return session.completions.skills
                .filter { $0.userInvocable && $0.name.hasPrefix(token.query) }
                .prefix(8)
                .map { skill in
                    Suggestion(id: "skill:\(skill.id)", label: "$\(skill.name)", detail: skill.description_p, icon: "book") {
                        complete(token.complete(text, with: "$\(skill.name)"))
                    }
                }
        case .file:
            return files.prefix(8).map { file in
                Suggestion(id: "file:\(file.path)", label: ComposerToken.fileReference(file.path), detail: "", icon: "doc") {
                    complete(token.complete(text, with: ComposerToken.fileReference(file.path)))
                }
            }
        case .tool, .command:
            let commands: [Suggestion] = ComposerToken.command(in: text) != nil && target.chat != nil && !(target.chat?.running ?? false)
                ? ChatCommand.allCases.filter { $0.rawValue.hasPrefix(token.query) }.map { command in
                    Suggestion(id: "command:\(command.rawValue)", label: "/\(command.rawValue)", detail: command.description, icon: "command") {
                        run(command)
                    }
                }
                : []
            let tools = session.completions.tools
                .filter { token.query.isEmpty || $0.name.localizedCaseInsensitiveContains(token.query) }
                .prefix(8)
                .map { tool in
                    Suggestion(id: "tool:\(tool.name)", label: "/\(tool.name)", detail: tool.description_p, icon: "powerplug") {
                        complete(token.complete(text, with: "/\(tool.name)"))
                    }
                }
            return commands + tools
        }
    }

    private func loadFiles() async {
        guard let token, token.kind == .file, let chat = target.chat else {
            files = []
            return
        }
        try? await Task.sleep(for: .milliseconds(150))
        guard !Task.isCancelled else { return }
        var request = Euler_V1_ListFilesRequest()
        request.sessionID = chat.id
        if !token.query.isEmpty { request.query = token.query }
        do {
            files = try await session.backend.workspace.listFiles(request: request, headers: [:]).value().files
            filesFailed = false
        } catch {
            guard !Task.isCancelled else { return }
            files = []
            filesFailed = true
        }
    }
}

/// Every model the user can send to, searchable, favorites first.
struct ModelPickerSheet: View {
    let selected: String?
    let pick: (Euler_V1_Model) -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        NavigationStack {
            List {
                let models = session.models.selectable.filter {
                    search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.id.localizedCaseInsensitiveContains(search)
                }
                let favorites = models.filter(\.favorite)
                if !favorites.isEmpty {
                    Section("Favorites") { ForEach(favorites, id: \.id) { row($0) } }
                }
                ForEach(providers(of: models), id: \.self) { provider in
                    Section(provider.name) {
                        ForEach(models.filter { $0.provider == provider }, id: \.id) { row($0) }
                    }
                }
                if session.models.selectable.isEmpty {
                    ContentUnavailableView(
                        session.models.error ?? "No models",
                        systemImage: "cpu",
                        description: Text("Connect a provider in Settings.")
                    )
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Choose model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .refreshable { await session.models.load() }
        }
    }

    private func row(_ model: Euler_V1_Model) -> some View {
        Button {
            pick(model)
            Haptics.light()
            dismiss()
        } label: {
            HStack {
                ProviderIcon(provider: model.provider)
                VStack(alignment: .leading, spacing: 2) {
                    Text(model.name).foregroundStyle(.primary)
                    if model.lab != model.providerName {
                        Text(model.lab).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if model.acceptsImages {
                    Image(systemName: "eye").font(.caption).foregroundStyle(.secondary).accessibilityLabel("Vision")
                }
                if model.id == selected {
                    Image(systemName: "checkmark").foregroundStyle(.tint)
                }
            }
        }
        .swipeActions {
            Button(model.favorite ? "Unfavorite" : "Favorite", systemImage: model.favorite ? "star.slash" : "star") {
                Task { await session.notices.attempt { try await session.models.setFavorite(model, !model.favorite) } }
            }
            .tint(.yellow)
        }
    }

    private func providers(of models: [Euler_V1_Model]) -> [Euler_V1_ModelProvider] {
        var seen: [Euler_V1_ModelProvider] = []
        for model in models where !seen.contains(model.provider) { seen.append(model.provider) }
        return seen
    }
}

extension Euler_V1_ModelProvider {
    var name: String {
        switch self {
        case .ollama: "Ollama"
        case .openrouter: "OpenRouter"
        case .chatgpt: "ChatGPT"
        default: "Other"
        }
    }
}
