import EulerAPI
import SwiftUI

/// The app's home: chats grouped by recency, and the way into a new chat and Settings.
struct ChatListView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var path: [AppSession.Route] = []
    @State private var renaming: Euler_V1_SessionSummary?
    @State private var deleting: Euler_V1_SessionSummary?
    @State private var showingSettings = false

    var body: some View {
        NavigationStack(path: $path) {
            list
                .navigationTitle("Chats")
                .toolbar { toolbar }
                .navigationDestination(for: AppSession.Route.self) { route in
                    switch route {
                    case .chat(let id): ChatView(chat: session.chat(id))
                    case .newChat: NewChatView(path: $path)
                    }
                }
                .refreshable {
                    await session.sessions.reload()
                    await session.models.load()
                }
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
        }
        .sheet(item: $renaming) { summary in
            RenameChatSheet(summary: summary)
        }
        .confirmationDialog(
            "Delete this chat?",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible,
            presenting: deleting
        ) { summary in
            Button("Delete", role: .destructive) { Task { await delete(summary) } }
        } message: { summary in
            Text(summary.title)
        }
        .overlay(alignment: .top) { NoticeBanner() }
        .onChange(of: session.route) { _, route in
            guard let route else { return }
            path = [route]
            session.route = nil
        }
    }

    @ViewBuilder
    private var list: some View {
        let sessions = session.sessions
        if !sessions.loaded {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if sessions.sessions.isEmpty {
            ContentUnavailableView {
                Label(sessions.error == nil ? "No chats" : "Can't load chats", systemImage: "bubble.left.and.text.bubble.right")
            } description: {
                if let error = sessions.error { Text(error) }
            } actions: {
                Button("New chat") { path = [.newChat] }
                    .buttonStyle(.borderedProminent)
                    .foregroundStyle(palette.background)
            }
        } else {
            List {
                ForEach(groups, id: \.label) { group in
                    Section(group.label) {
                        ForEach(group.sessions, id: \.id) { summary in
                            NavigationLink(value: AppSession.Route.chat(summary.id)) {
                                ChatRow(summary: summary)
                            }
                            .swipeActions(edge: .trailing) {
                                Button("Delete", systemImage: "trash", role: .destructive) { deleting = summary }
                                Button("Rename", systemImage: "pencil") { renaming = summary }
                                    .tint(.gray)
                            }
                            .contextMenu {
                                Button("Rename", systemImage: "pencil") { renaming = summary }
                                Button("Delete", systemImage: "trash", role: .destructive) { deleting = summary }
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(palette.background)
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Settings", systemImage: "gearshape") { showingSettings = true }
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button("New chat", systemImage: "square.and.pencil") { path = [.newChat] }
        }
    }

    private var groups: [(label: String, sessions: [Euler_V1_SessionSummary])] {
        var result: [(label: String, sessions: [Euler_V1_SessionSummary])] = []
        let now = Date.now
        for summary in session.sessions.sessions {
            let label = Format.group(summary.updatedAt.date, now: now)
            if result.last?.label == label {
                result[result.count - 1].sessions.append(summary)
            } else {
                result.append((label, [summary]))
            }
        }
        return result
    }

    private func delete(_ summary: Euler_V1_SessionSummary) async {
        let deleted = await session.notices.attempt { try await session.sessions.delete(summary.id) }
        if deleted {
            Haptics.firm()
            session.forget(summary.id)
            path.removeAll { $0 == .chat(summary.id) }
        }
    }
}

private struct ChatRow: View {
    let summary: Euler_V1_SessionSummary
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                if summary.hasExpiresAt {
                    Image(systemName: "eye.slash")
                        .font(.caption)
                        .foregroundStyle(.yellow)
                        .accessibilityLabel("Ephemeral")
                }
                Text(summary.title)
                    .lineLimit(2)
                    .foregroundStyle(palette.foreground)
            }
            HStack(spacing: 6) {
                switch summary.badge {
                case .working:
                    ProgressView().controlSize(.mini)
                    Text("Working")
                case .unread:
                    Circle().fill(palette.accent).frame(width: 7, height: 7)
                    Text("Unread")
                default:
                    EmptyView()
                }
                if summary.hasExpiresAt {
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        Text(Format.expiresIn(summary.expiresAt.date, now: context.date))
                    }
                } else {
                    Text(Format.sessionTime(summary.updatedAt.date))
                }
            }
            .font(.footnote)
            .foregroundStyle(palette.muted)
        }
        .padding(.vertical, 2)
    }
}

private struct RenameChatSheet: View {
    let summary: Euler_V1_SessionSummary
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                TextField(summary.preview, text: $title)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit { Task { await save() } }
            }
            .navigationTitle("Rename")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } } }
            }
        }
        .presentationDetents([.height(200)])
        .onAppear {
            title = summary.hasCustomTitle ? summary.customTitle : ""
            focused = true
        }
    }

    private func save() async {
        if await session.notices.attempt({ try await session.sessions.rename(summary.id, to: title) }) {
            dismiss()
        }
    }
}

/// The current notice, floating over the screen until it times out or is tapped.
struct NoticeBanner: View {
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette

    var body: some View {
        if let notice = session.notices.current {
            Button { session.notices.dismiss() } label: {
                Label(notice.message, systemImage: notice.tone == .failure ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                    .font(.subheadline)
                    .foregroundStyle(palette.foreground)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .glassEffect()
            }
            .buttonStyle(.plain)
            .padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
            .animation(.snappy, value: notice)
        }
    }
}
