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
    @FocusState private var composerFocused: Bool

    var body: some View {
        Group {
            if chat.loaded || !chat.history.isEmpty {
                TranscriptView(chat: chat, sheet: $sheet)
                    // Taps elsewhere put the composer's keyboard away, but not an inline editor's.
                    .simultaneousGesture(TapGesture().onEnded { composerFocused = false })
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
                ComposerView(target: .chat(chat), sheet: $sheet, focused: $composerFocused)
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 6)
            .padding(.top, 10)
            // The transcript fades out under the composer, as under the web's frosted dock.
            .background {
                LinearGradient(
                    stops: [.init(color: palette.background.opacity(0), location: 0), .init(color: palette.background, location: 0.35)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let summary = session.sessions.summary(chat.id), summary.hasExpiresAt {
                ToolbarItem(placement: .principal) { EphemeralTitle(summary: summary) }
            }
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
        .onChange(of: chat.requestedSheet, initial: true) { _, requested in
            guard let requested else { return }
            sheet = requested
            chat.requestedSheet = nil
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

/// An ephemeral chat's title with when it expires, as the web's amber header chip.
private struct EphemeralTitle: View {
    let summary: Euler_V1_SessionSummary
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(spacing: 1) {
            Text(summary.title)
                .font(.headline)
                .foregroundStyle(palette.foreground)
                .lineLimit(1)
            TimelineView(.periodic(from: .now, by: 60)) { context in
                Label(Format.expiresIn(summary.expiresAt.date, now: context.date), systemImage: "eye.slash")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Palette.ephemeral)
                    .labelStyle(.titleAndIcon)
            }
        }
        .accessibilityElement(children: .combine)
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
    /// A message's text, opened to select part of it.
    case text(String)

    var id: String {
        switch self {
        case .agents: "agents"
        case .agent(let id): "agent:\(id)"
        case .job(let id): "job:\(id)"
        case .trace(let steps): "trace:\(steps.count):\(steps.first?.startedAt.seconds ?? 0)"
        case .workspace: "workspace"
        case .artifacts(let path): "artifacts:\(path ?? "")"
        case .sources(let sources): "sources:\(sources.map(\.url).joined())"
        case .text(let text): "text:\(text.hashValue)"
        }
    }
}

private struct ChatSheetView: View {
    let sheet: ChatSheet
    let chat: ChatStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        switch sheet {
        case .agents: AgentsSheet(chat: chat)
        case .agent(let id): page { AgentDetailView(chat: chat, agentID: id) }
        case .job(let id): page { JobDetailView(chat: chat, jobID: id) }
        case .trace(let steps): page { TraceView(steps: steps) }
        case .workspace: WorkspaceSheet(chat: chat)
        case .artifacts(let path): ArtifactsView(chat: chat, initialPath: path)
        case .sources(let sources): SourcesSheet(sources: sources)
        case .text(let text): SelectTextSheet(text: text)
        }
    }

    /// A page that is the whole sheet: its own stack, with the X that closes it.
    private func page(@ViewBuilder _ content: () -> some View) -> some View {
        NavigationStack {
            content().toolbar { CloseToolbarItem { dismiss() } }
        }
    }
}

private struct ChatMenu: View {
    let chat: ChatStore
    @Binding var sheet: ChatSheet?

    var body: some View {
        Menu {
            Button("Agents and jobs", systemImage: "person.2", action: Haptics.selecting { sheet = .agents })
            Button("Workspace", systemImage: "folder", action: Haptics.selecting { sheet = .workspace })
            Button("Files", systemImage: "doc.on.doc", action: Haptics.selecting { sheet = .artifacts(path: nil) })
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

extension Euler_V1_Job {
    var isActive: Bool { status == .starting || status == .running }
}
