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
                .transition(.opacity.combined(with: .offset(y: 6)))
            } else if token?.kind == .file, target.chat != nil {
                Text(filesFailed ? "Could not load workspace files" : "No matching files")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(palette.surface, in: .rect(cornerRadius: 14))
                    .transition(.opacity.combined(with: .offset(y: 6)))
            }
        }
        .animation(.snappy(duration: 0.2), value: suggestions.map(\.id))
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
            // A new chat works in its own sandbox already, so it has nothing to return to.
            let commands: [Suggestion] = ComposerToken.command(in: text) != nil && !(target.chat?.running ?? false)
                ? ChatCommand.allCases.filter { $0.rawValue.hasPrefix(token.query) && ($0 != .sandbox || target.chat != nil) }.map { command in
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
