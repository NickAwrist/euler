import EulerAPI
import SwiftUI

/// One chat: its transcript, the turn streaming in, approvals and the composer.
struct ChatView: View {
    let chat: ChatStore
    @Environment(AppSession.self) private var session
    @Environment(PushNotifications.self) private var push
    @Environment(\.palette) private var palette
    @Environment(\.scenePhase) private var scenePhase
    @State private var sheet: ChatSheet?

    var body: some View {
        Group {
            if chat.loaded || !chat.history.isEmpty {
                TranscriptView(chat: chat, sheet: $sheet)
            } else if let error = chat.loadError {
                ContentUnavailableView {
                    Label("Can't open this chat", systemImage: "exclamationmark.bubble")
                } description: {
                    Text(error)
                } actions: {
                    Button("Retry") { Task { await chat.load() } }
                }
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(palette.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 8) {
                ApprovalCards(chat: chat)
                QueuedMessages(chat: chat)
                ComposerView(target: .chat(chat), sheet: $sheet)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { ChatMenu(chat: chat, sheet: $sheet) }
        }
        .sheet(item: $sheet) { sheet in
            ChatSheetView(sheet: sheet, chat: chat)
        }
        .task(id: chat.id) {
            chat.isVisible = true
            if !chat.loaded { await chat.load() } else { await chat.refresh() }
            await session.sessions.markViewed(chat.id)
            await push.clearDelivered(sessionID: chat.id)
        }
        .onDisappear { chat.isVisible = false }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await chat.refresh() } }
        }
    }

    private var title: String {
        session.sessions.summary(chat.id)?.title ?? "Chat"
    }
}

/// The sheets a chat opens.
enum ChatSheet: Identifiable, Hashable {
    case agents
    case agent(String)
    case job(String)
    case trace([Euler_V1_Step])
    case workspace
    case artifacts(path: String?)
    case sources([Euler_V1_WebSourceAttachment])

    var id: String {
        switch self {
        case .agents: "agents"
        case .agent(let id): "agent:\(id)"
        case .job(let id): "job:\(id)"
        case .trace(let steps): "trace:\(steps.count):\(steps.first?.startedAt.seconds ?? 0)"
        case .workspace: "workspace"
        case .artifacts(let path): "artifacts:\(path ?? "")"
        case .sources(let sources): "sources:\(sources.map(\.url).joined())"
        }
    }
}

private struct ChatSheetView: View {
    let sheet: ChatSheet
    let chat: ChatStore

    var body: some View {
        switch sheet {
        case .agents: AgentsSheet(chat: chat)
        case .agent(let id): NavigationStack { AgentDetailView(chat: chat, agentID: id) }
        case .job(let id): NavigationStack { JobDetailView(chat: chat, jobID: id) }
        case .trace(let steps): NavigationStack { TraceView(steps: steps) }
        case .workspace: WorkspaceSheet(chat: chat)
        case .artifacts(let path): ArtifactsView(chat: chat, initialPath: path)
        case .sources(let sources): SourcesSheet(sources: sources)
        }
    }
}

private struct ChatMenu: View {
    let chat: ChatStore
    @Binding var sheet: ChatSheet?

    var body: some View {
        Menu {
            Button("Agents and jobs", systemImage: "person.2") { sheet = .agents }
            Button("Workspace", systemImage: "folder") { sheet = .workspace }
            Button("Files", systemImage: "doc.on.doc") { sheet = .artifacts(path: nil) }
        } label: {
            Label("Chat options", systemImage: "ellipsis")
                .overlay(alignment: .topTrailing) {
                    if chat.subagents.contains(where: \.isWorking) || chat.jobs.contains(where: \.isActive) {
                        Circle().fill(.green).frame(width: 7, height: 7).offset(x: 3, y: -2)
                    }
                }
        }
    }
}

/// A chat that exists once its first message is sent.
struct NewChatView: View {
    @Binding var path: [AppSession.Route]
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var draft = ComposerDraft()
    @State private var ephemeral = false
    @State private var sheet: ChatSheet?

    var body: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "sparkles")
                .font(.title)
                .foregroundStyle(palette.foreground)
                .frame(width: 56, height: 56)
                .background(palette.surface, in: .rect(cornerRadius: 14))
            Text("What are we working on today?")
                .font(Typography(font: .serif).body(size: 28, relativeTo: .largeTitle))
                .multilineTextAlignment(.center)
                .foregroundStyle(palette.foreground)
            Spacer()
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
        .background(palette.background)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ComposerView(target: .new(draft, ephemeral: ephemeral, start: { id in
                path = [.chat(id)]
            }), sheet: $sheet)
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
        }
        .navigationTitle(ephemeral ? "Ephemeral chat" : "New chat")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Toggle(isOn: $ephemeral.animation()) {
                    Label("Ephemeral", systemImage: ephemeral ? "eye.slash.fill" : "eye.slash")
                }
                .toggleStyle(.button)
                .tint(.yellow)
                .accessibilityHint("Deleted after it expires")
            }
        }
    }
}

extension Euler_V1_Job {
    var isActive: Bool { status == .starting || status == .running }
}
