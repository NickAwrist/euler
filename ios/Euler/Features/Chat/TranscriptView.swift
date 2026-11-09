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

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(Array(chat.history.enumerated()), id: \.offset) { index, message in
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
                LiveReplyView(chat: chat, sheet: $sheet)
                    .id("live")
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 12)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom)
        .scrollDismissesKeyboard(.interactively)
        .onScrollGeometryChange(for: Bool.self) { geometry in
            geometry.contentOffset.y + geometry.containerSize.height >= geometry.contentSize.height - 80
        } action: { _, isAtBottom in
            atBottom = isAtBottom
        }
        .onChange(of: chat.live.activation?.content) { follow() }
        .onChange(of: chat.live.activation?.steps.count) { follow() }
        .onChange(of: chat.history.count) { old, new in
            // A message the user just sent always comes into view.
            if new > old, chat.history.last?.role == .user { atBottom = true }
            follow()
        }
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

/// The main agent's turn in progress: its thinking, steps and text so far.
private struct LiveReplyView: View {
    let chat: ChatStore
    @Binding var sheet: ChatSheet?
    @Environment(\.palette) private var palette

    var body: some View {
        if let activation = chat.live.activation {
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
            .transition(.opacity)
        }
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
