import EulerAPI
import SwiftUI

/// The web's sidebar: new and ephemeral chat, chats grouped by recency, and
/// the way to Usage, Customization and Settings.
struct ChatDrawer: View {
    let current: String?
    let open: (String) -> Void
    let newChat: (_ ephemeral: Bool) -> Void
    let deleted: (String) -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.openSettings) private var openSettings
    @State private var renaming: Euler_V1_SessionSummary?
    @State private var deleting: Euler_V1_SessionSummary?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Recent")
                .font(.headline)
                .foregroundStyle(palette.foreground)
                .padding(.horizontal, 18)
                .padding(.top, 14)
                .padding(.bottom, 12)
            HStack(spacing: 8) {
                Button { newChat(false) } label: {
                    Label("New chat", systemImage: "plus")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(palette.foreground)
                        .frame(maxWidth: .infinity, minHeight: 42)
                        .background(palette.surface, in: .rect(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.borderSubtle))
                }
                Button { newChat(true) } label: {
                    Image(systemName: "eye.slash")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Palette.ephemeral)
                        .frame(width: 46, height: 42)
                        .background(Palette.ephemeral.opacity(0.06), in: .rect(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.ephemeral.opacity(0.22)))
                }
                .accessibilityLabel("New ephemeral chat")
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.bottom, 10)
            Rectangle().fill(palette.borderSubtle).frame(height: 1)
            list
            Rectangle().fill(palette.borderSubtle).frame(height: 1)
            VStack(spacing: 2) {
                footerButton("Usage insights", systemImage: "chart.line.uptrend.xyaxis") { openSettings(.usage) }
                footerButton("Customization", systemImage: "slider.horizontal.3") { openSettings(.personalization) }
                footerButton("Settings", systemImage: "gearshape") { openSettings(.root) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
        }
        .background(palette.background)
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
    }

    @ViewBuilder
    private var list: some View {
        let sessions = session.sessions
        if !sessions.loaded {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if sessions.sessions.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(sessions.error ?? "No chats yet. Start one from the button above.")
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                if sessions.error != nil {
                    Button("Retry") { Task { await sessions.reload() } }.font(.footnote.weight(.semibold))
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        } else {
            List {
                ForEach(groups, id: \.label) { group in
                    // Headers are plain rows so they scroll away, as on the web, rather than stick.
                    Text(group.label)
                        .font(.caption2.weight(.semibold))
                        .textCase(.uppercase)
                        .tracking(1)
                        .foregroundStyle(palette.muted)
                        .padding(.horizontal, 16)
                        .padding(.top, 14)
                        .padding(.bottom, 2)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(palette.background)
                        .listRowSeparator(.hidden)
                        .accessibilityAddTraits(.isHeader)
                    ForEach(group.sessions, id: \.id) { summary in
                        Button { open(summary.id) } label: {
                            ChatRow(summary: summary, active: summary.id == current)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("Drawer chat")
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(summary.id == current ? palette.fill : palette.background)
                        .listRowSeparatorTint(palette.borderSubtle)
                        .swipeActions(edge: .trailing) {
                            Button("Delete", systemImage: "trash", role: .destructive) { deleting = summary }
                                .tint(.red)
                            Button("Rename", systemImage: "pencil") { renaming = summary }
                                .tint(palette.border)
                        }
                        .contextMenu {
                            Button("Rename", systemImage: "pencil") { renaming = summary }
                            Button("Delete", systemImage: "trash", role: .destructive) { deleting = summary }
                        }
                    }
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(palette.background)
            .refreshable {
                await session.sessions.reload()
                await session.models.load()
            }
        }
    }

    private func footerButton(_ title: String, systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: systemImage)
                .font(.footnote.weight(.medium))
                .foregroundStyle(palette.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 9)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
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
        let removed = await session.notices.attempt { try await session.sessions.delete(summary.id) }
        if removed {
            Haptics.firm()
            session.forget(summary.id)
            deleted(summary.id)
        }
    }
}

/// One chat: its title with a working or unread mark, and when it changed or expires.
private struct ChatRow: View {
    let summary: Euler_V1_SessionSummary
    let active: Bool
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                switch summary.badge {
                case .working:
                    ProgressView().controlSize(.mini).accessibilityLabel("Agent working")
                case .unread where !active:
                    Circle().fill(palette.tint).frame(width: 7, height: 7).accessibilityLabel("New reply")
                default:
                    EmptyView()
                }
                Text(summary.title)
                    .font(.subheadline)
                    .lineLimit(2)
                    .foregroundStyle(palette.foreground)
            }
            HStack(spacing: 4) {
                Text(Format.sessionTime(summary.updatedAt.date))
                if summary.hasExpiresAt {
                    Text("·")
                    Image(systemName: "eye.slash").foregroundStyle(Palette.ephemeral).accessibilityLabel("Ephemeral")
                    TimelineView(.periodic(from: .now, by: 60)) { context in
                        Text(Format.expiresIn(summary.expiresAt.date, now: context.date))
                    }
                }
            }
            .font(.caption2)
            .foregroundStyle(palette.muted)
        }
        .padding(.leading, 16)
        .padding(.trailing, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) {
            if active { Rectangle().fill(palette.foreground.opacity(0.35)).frame(width: 2) }
        }
        .contentShape(.rect)
        .accessibilityAddTraits(active ? .isSelected : [])
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
            ThemedForm {
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
