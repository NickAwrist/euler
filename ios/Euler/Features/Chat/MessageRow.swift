import EulerAPI
import SwiftUI

/// One saved message: a user bubble, a reply, or an event note.
struct MessageRow: View {
    let chat: ChatStore
    let message: Euler_V1_Message
    let index: Int
    @Binding var editing: Int?
    @Binding var version: Int
    @Binding var sheet: ChatSheet?
    @Environment(\.palette) private var palette

    var body: some View {
        switch message.role {
        case .user:
            UserMessage(chat: chat, message: message, index: index, editing: $editing)
        case .assistant:
            AssistantMessage(chat: chat, message: message, index: index, version: $version, sheet: $sheet)
        default:
            HStack(spacing: 10) {
                Rectangle().fill(palette.borderSubtle).frame(height: 1)
                Text(message.content).font(.caption).foregroundStyle(palette.muted).fixedSize()
                Rectangle().fill(palette.borderSubtle).frame(height: 1)
            }
            .padding(.vertical, 10)
        }
    }
}

private struct UserMessage: View {
    let chat: ChatStore
    let message: Euler_V1_Message
    let index: Int
    @Binding var editing: Int?
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography
    @State private var draft = ""
    @State private var confirming = false
    @FocusState private var focused: Bool

    private var images: [Euler_V1_ImageAttachment] {
        message.attachments.compactMap { if case .image(let image) = $0.kind { image } else { nil } }
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if !images.isEmpty {
                HStack(spacing: 6) {
                    ForEach(images, id: \.id) { image in
                        RemoteImage(attachment: image.id, alt: image.name, contentMode: .fill)
                            .frame(width: 96, height: 96)
                    }
                }
            }
            if editing == index {
                editor
            } else {
                Text(message.content)
                    .font(typography.body())
                    .foregroundStyle(palette.foreground)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(palette.surface, in: .rect(cornerRadius: 18))
                    .contextMenu { actions }
                Menu { actions } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(palette.muted)
                        .frame(width: 36, height: 28)
                        .contentShape(.rect)
                }
                .accessibilityLabel("Message actions")
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 40)
        .padding(.top, 14)
        .confirmationDialog("Edit and rerun?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Rerun from here", role: .destructive) { Task { await rerun() } }
        } message: {
            Text("Messages and agents after this one are removed.")
        }
    }

    @ViewBuilder
    private var actions: some View {
        Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = message.content }
        if !chat.running {
            Button("Edit", systemImage: "pencil") {
                draft = message.content
                editing = index
                focused = true
            }
        }
    }

    private var editor: some View {
        VStack(alignment: .trailing, spacing: 8) {
            TextField("Message", text: $draft, axis: .vertical)
                .font(typography.body())
                .focused($focused)
                .lineLimit(1...10)
                .padding(12)
                .background(palette.surface, in: .rect(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(palette.border))
            HStack {
                Button("Cancel") { editing = nil }
                    .buttonStyle(.bordered)
                Button("Send") {
                    if chat.rerunDiscards(from: index + 1) { confirming = true } else { Task { await rerun() } }
                }
                .buttonStyle(.borderedProminent)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || chat.running)
            }
        }
    }

    private func rerun() async {
        let model = chat.session?.model
        let selected = model.flatMap { session.models.model($0) }
        let ok = await session.notices.attempt {
            try await chat.rewind(
                to: index,
                content: draft.trimmingCharacters(in: .whitespacesAndNewlines),
                versions: [],
                model: model,
                effort: session.models.effort(for: selected)
            )
        }
        if ok { editing = nil }
    }
}

private struct AssistantMessage: View {
    let chat: ChatStore
    let message: Euler_V1_Message
    let index: Int
    @Binding var version: Int
    @Binding var sheet: ChatSheet?
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var confirming = false

    /// The kept version being viewed, or the latest reply.
    private var shown: (content: String, steps: [Euler_V1_Step], attachments: [Euler_V1_MessageAttachment]) {
        if message.versions.indices.contains(version) {
            let kept = message.versions[version]
            return (kept.content, kept.steps, kept.attachments)
        }
        return (message.content, message.steps, message.attachments)
    }

    var body: some View {
        let shown = shown
        let thinking = ReplyThinking(steps: shown.steps)
        VStack(alignment: .leading, spacing: 10) {
            ReplyDivider()
            if let thinking {
                ThinkingDisclosure(text: thinking.text, duration: thinking.duration, live: false)
            }
            MarkdownView(source: shown.content)
                .contextMenu { actions(shown) }
            ReplyAttachments(attachments: shown.attachments, content: shown.content, sheet: $sheet)
            HStack(spacing: 2) {
                if !message.versions.isEmpty {
                    VersionPager(index: $version, count: message.versions.count + 1)
                }
                Menu { actions(shown) } label: {
                    Image(systemName: "ellipsis")
                        .foregroundStyle(palette.muted)
                        .frame(width: 36, height: 28)
                        .contentShape(.rect)
                }
                .accessibilityLabel("Message actions")
            }
        }
        .padding(.bottom, 4)
        .confirmationDialog("Regenerate this reply?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Regenerate", role: .destructive) { Task { await regenerate() } }
        } message: {
            Text("Messages and agents after it are removed. This reply is kept as a version.")
        }
    }

    @ViewBuilder
    private func actions(_ shown: (content: String, steps: [Euler_V1_Step], attachments: [Euler_V1_MessageAttachment])) -> some View {
        Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = shown.content }
        if !chat.running {
            Button("Regenerate", systemImage: "arrow.clockwise") {
                if chat.rerunDiscards(from: index) { confirming = true } else { Task { await regenerate() } }
            }
        }
        if !TraceView.displayed(shown.steps).isEmpty {
            Button("View trace", systemImage: "point.3.connected.trianglepath.dotted") { sheet = .trace(shown.steps) }
        }
    }

    private func regenerate() async {
        let model = chat.session?.model
        let selected = model.flatMap { session.models.model($0) }
        await session.notices.attempt {
            try await chat.regenerate(at: index, model: model, effort: session.models.effort(for: selected))
        }
    }
}

/// ‹ 2/3 › between a reply and the versions Regenerate kept.
private struct VersionPager: View {
    @Binding var index: Int
    let count: Int
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 0) {
            Button("Previous version", systemImage: "chevron.left") { index -= 1 }
                .disabled(index == 0)
            Text("\(index + 1)/\(count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(palette.muted)
            Button("Next version", systemImage: "chevron.right") { index += 1 }
                .disabled(index == count - 1)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.borderless)
        .font(.caption)
        .sensoryFeedback(.selection, trigger: index)
    }
}

/// The main agent's reasoning across a reply's model calls. A port of replyThinking.ts.
struct ReplyThinking {
    let text: String
    let duration: Double?

    init?(steps: [Euler_V1_Step]) {
        let calls = steps.filter { $0.kind == .llmCall && !$0.thinking.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        guard !calls.isEmpty else { return nil }
        text = calls.map { $0.thinking.trimmingCharacters(in: .whitespacesAndNewlines) }.joined(separator: "\n\n")
        let durations = calls.compactMap { $0.metrics.hasThinkingDurationMs ? $0.metrics.thinkingDurationMs : nil }
        duration = durations.isEmpty ? nil : durations.reduce(0, +)
    }
}

/// "Thoughts", collapsed until tapped.
struct ThinkingDisclosure: View {
    let text: String
    let duration: Double?
    let live: Bool
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.snappy) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                    Text(label)
                    Image(systemName: "chevron.right")
                        .font(.caption2)
                        .rotationEffect(.degrees(expanded ? 90 : 0))
                }
                .font(.subheadline)
                .foregroundStyle(palette.muted)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            if expanded || live {
                Text(text)
                    .font(typography.body(size: 15))
                    .foregroundStyle(palette.muted)
                    .lineLimit(expanded ? nil : 3)
                    .padding(.leading, 12)
                    .overlay(alignment: .leading) { Rectangle().fill(palette.borderSubtle).frame(width: 2) }
            }
        }
    }

    private var label: String {
        if live { return "Thinking" }
        if let duration { return "Thought for \(Format.duration(milliseconds: duration))" }
        return "Thoughts"
    }
}
