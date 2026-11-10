import EulerAPI
import SwiftUI

/// The saved messages, each followed by the subagents and jobs it started, then
/// the turn in progress. Follows new text while the reader is at the bottom.
struct TranscriptView: View {
    let chat: ChatStore
    @Binding var sheet: ChatSheet?
    @Environment(\.palette) private var palette
    @State private var position = ScrollPosition(edge: .bottom)
    @State private var atBottom = true
    @State private var editing: Int?
    @State private var versionChoices: [Int: Int] = [:]
    /// The first message built whole rather than lazily: the last few when the chat
    /// opened, and every one after. The lazy stack keeps stale heights for rows that
    /// change or move, and near the bottom anchor that left the view scrolled past the
    /// end of the content, showing nothing until it was scrolled.
    @State private var builtWholeFrom: Int
    /// Set while a row opens or closes where it stands.
    @State private var resizingInPlace = false

    /// Enough messages to fill the screen when a chat opens.
    private static let recentBuiltWhole = 10

    init(chat: ChatStore, sheet: Binding<ChatSheet?>) {
        self.chat = chat
        _sheet = sheet
        _builtWholeFrom = State(initialValue: max(0, chat.history.count - Self.recentBuiltWhole))
    }

    var body: some View {
        // A message on its way into the saved ones is drawn as it will be once it is
        // there, in the row it will have, so being saved changes nothing on screen.
        let messages = chat.history + chat.arriving
        let lazy = min(builtWholeFrom, chat.history.count)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(0..<lazy, id: \.self) { index in
                    row(messages[index], at: index)
                }
                // Recent messages and the turn in progress are one row of the lazy stack,
                // built whole: the stack runs no transition for a row it builds, and here a
                // sent message and the reply to it unfold.
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(lazy..<messages.count, id: \.self) { index in
                        row(messages[index], at: index)
                            .transition(messages[index].role == .user ? .unfold : .identity)
                    }
                    LiveReplyView(chat: chat, sheet: $sheet)
                        .id("live")
                }
                // A finished reply replaces the streamed one where it stands, so only a
                // message being sent is animated.
                .animation(messages.last?.role == .user ? .snappy(duration: 0.3) : nil, value: messages.count)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 12)
        }
        .scrollPosition($position)
        // New text keeps the bottom edge in place. A row opened by hand keeps its own
        // place instead and pushes what follows down, or it would run off the top.
        .defaultScrollAnchor(resizingInPlace ? .top : .bottom, for: .sizeChanges)
        .defaultScrollAnchor(.bottom)
        .environment(\.resizeInPlace) { change in
            resizingInPlace = true
            // A turn of the run loop later, once the scroll view has the new anchor.
            Task {
                withAnimation(.smooth(duration: 0.3), change) { resizingInPlace = false }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 80
        } action: { _, isAtBottom in
            atBottom = isAtBottom
        }
        .onChange(of: chat.live.activation?.content) { old, new in
            if (new?.utf8.count ?? 0) > (old?.utf8.count ?? 0) { Haptics.streaming() }
            follow()
        }
        .onChange(of: chat.live.activation?.steps.count) { follow() }
        .onChange(of: chat.arriving.count) { old, new in
            if new > old { atBottom = true }
            follow()
        }
        .onChange(of: chat.history.count) { old, new in
            // An edit or regeneration drops messages; the ones that replace them are built
            // whole too, or they would move into the lazy rows as they are saved.
            if new < builtWholeFrom { builtWholeFrom = new }
            // A message the user just sent always comes into view.
            if new > old, chat.history.last?.role == .user { atBottom = true }
            follow()
        }
    }

    @ViewBuilder
    private func row(_ message: Euler_V1_Message, at index: Int) -> some View {
        MessageRow(
            chat: chat,
            message: message,
            index: index,
            editing: $editing,
            version: versionBinding(index, count: message.versions.count),
            sheet: $sheet
        )
        TaskCards(chat: chat, position: index, sheet: $sheet)
    }

    private func follow() {
        guard atBottom, editing == nil else { return }
        position.scrollTo(edge: .bottom)
    }

    /// Which kept version of a reply is shown; a new version shows the latest.
    private func versionBinding(_ index: Int, count: Int) -> Binding<Int> {
        Binding(
            get: { min(versionChoices[index] ?? count, count) },
            set: { versionChoices[index] = $0 }
        )
    }
}

extension EnvironmentValues {
    /// Animates a change to a transcript row's height, such as opening its thoughts.
    @Entry var resizeInPlace: (@escaping () -> Void) -> Void = { change in
        withAnimation(.smooth(duration: 0.3), change)
    }
}

/// The main agent's turn in progress: its thinking, steps and text so far.
private struct LiveReplyView: View {
    let chat: ChatStore
    @Binding var sheet: ChatSheet?
    @Environment(\.palette) private var palette

    var body: some View {
        let activation = chat.live.activation
        // Always a row of the transcript, empty between turns, so a turn starting is a
        // change inside the row and can unfold; a row that appears has no transition.
        VStack(alignment: .leading, spacing: 0) {
            if let activation {
                let steps = chat.live.steps
                VStack(alignment: .leading, spacing: 10) {
                    ReplyDivider()
                    if !activation.thinking.isEmpty, activation.content.isEmpty {
                        ThinkingDisclosure(text: activation.thinking, duration: nil, live: true)
                    }
                    if !activation.content.isEmpty {
                        MarkdownView(source: activation.content)
                    }
                    StreamingStatus(steps: steps, phase: chat.mainAgent.flatMap { chat.phases[$0.id] }) {
                        sheet = .trace(steps)
                    }
                }
                .padding(.bottom, 8)
                .transition(.unfold)
            }
        }
        // The finished reply replaces this one where it stands, so only its start is animated.
        .animation(activation == nil ? nil : .snappy(duration: 0.3), value: activation == nil)
    }
}

/// What the turn is doing now: thinking, writing, or running a tool.
private struct StreamingStatus: View {
    let steps: [Euler_V1_Step]
    let phase: AgentPhase?
    let openTrace: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: openTrace) {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(label)
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                    .lineLimit(1)
                if !steps.isEmpty {
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(palette.muted)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .disabled(steps.isEmpty)
        .accessibilityLabel("\(label). View trace")
    }

    private var label: String {
        if let running = steps.last(where: { $0.status == .running }), running.kind == .toolCall {
            return "Running \(running.toolName)"
        }
        switch phase {
        case .tool: return "Running a tool"
        case .responding: return "Writing"
        case .thinking: return "Thinking"
        case nil: return "Working"
        }
    }
}

/// The short rule above each reply, as on the web.
struct ReplyDivider: View {
    @Environment(\.palette) private var palette

    var body: some View {
        Capsule().fill(palette.borderSubtle).frame(width: 32, height: 1).padding(.top, 14)
    }
}
