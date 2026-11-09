import EulerAPI
import SwiftProtobuf
import SwiftUI

/// Tool calls waiting for the user, above the composer so typing goes on.
struct ApprovalCards: View {
    let chat: ChatStore
    @State private var savedRule: Euler_V1_ToolPermissionRule?

    var body: some View {
        VStack(spacing: 8) {
            if let savedRule {
                SavedRuleNotice(rule: savedRule) { self.savedRule = nil }
            }
            ForEach(chat.approvals, id: \.id) { approval in
                ApprovalCard(chat: chat, approval: approval) { rule in
                    withAnimation(.snappy) { savedRule = rule }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: chat.approvals.map(\.id))
        // Leaving a chat drops its notice, so returning never offers a stale Undo.
        .onChange(of: chat.id) { savedRule = nil }
    }
}

private struct ApprovalCard: View {
    let chat: ChatStore
    let approval: Euler_V1_ToolApproval
    let onSavedRule: (Euler_V1_ToolPermissionRule) -> Void
    @Environment(\.palette) private var palette
    @State private var pending: Euler_V1_ApprovalDecision?
    @State private var failure: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "questionmark.shield").foregroundStyle(.orange)
                Text("\(Text(approval.agentTitle).bold()) wants to run \(Text(approval.tool).monospaced())")
                    .font(.subheadline)
                if approval.arguments.fields["background"]?.boolValue == true {
                    Text("Background")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(palette.borderSubtle, in: .rect(cornerRadius: 4))
                }
            }
            Text("\(approval.reason) In \(approval.workspacePath)")
                .font(.caption)
                .foregroundStyle(palette.muted)
                .lineLimit(2)
            ScrollView {
                Text(approval.arguments.prettyJSON)
                    .font(.caption.monospaced())
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .frame(maxHeight: 96)
            .padding(8)
            .background(palette.background, in: .rect(cornerRadius: 6))
            .accessibilityLabel("\(approval.tool) arguments")
            if approval.tool == "bash" {
                Text("Rules match command text. The OS sandbox still applies.")
                    .font(.caption2)
                    .foregroundStyle(palette.muted)
            }
            if let failure {
                Text(failure).font(.caption).foregroundStyle(.red)
            }
            Text("Matching calls: \(approval.matchingScope)")
                .font(.caption2)
                .foregroundStyle(palette.muted)
                .lineLimit(2)
            HStack(spacing: 8) {
                decision("Deny", .deny, prominent: false)
                decision("Allow matching", .allowMatching, prominent: false)
                decision("Allow once", .allowOnce, prominent: true)
            }
        }
        .padding(12)
        .background(palette.surface, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(.orange.opacity(0.35)))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(approval.agentTitle) wants to run \(approval.tool)")
    }

    @ViewBuilder
    private func decision(_ title: String, _ value: Euler_V1_ApprovalDecision, prominent: Bool) -> some View {
        let button = Button {
            Task { await respond(value) }
        } label: {
            Group {
                if pending == value { ProgressView().controlSize(.small) } else { Text(title) }
            }
            .font(.footnote.weight(.medium))
            .frame(maxWidth: .infinity, minHeight: 32)
        }
        .disabled(pending != nil)
        if prominent {
            button.buttonStyle(.borderedProminent)
        } else {
            button.buttonStyle(.bordered)
        }
    }

    private func respond(_ value: Euler_V1_ApprovalDecision) async {
        pending = value
        failure = nil
        do {
            let rule = try await chat.respond(to: approval, value)
            if value == .deny { Haptics.firm() } else { Haptics.success() }
            if let rule { onSavedRule(rule) }
        } catch {
            failure = error.displayMessage
            Haptics.failure()
        }
        pending = nil
    }
}

/// "Saved: allow matching bash calls", with Undo for a few seconds.
private struct SavedRuleNotice: View {
    let rule: Euler_V1_ToolPermissionRule
    let dismiss: () -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette

    var body: some View {
        HStack {
            Text("Saved: allow matching \(rule.tool) calls.")
                .font(.footnote)
                .foregroundStyle(palette.muted)
            Spacer()
            Button("Undo") {
                Task {
                    var request = Euler_V1_DeletePermissionRuleRequest()
                    request.ruleID = rule.id
                    let removed = await session.notices.attempt {
                        let response = try await session.preferences.client.deletePermissionRule(request: request, headers: [:]).value()
                        session.preferences.adopt(response.preferences)
                    }
                    if removed { session.notices.info("Removed the rule for \(rule.tool).") }
                    dismiss()
                }
            }
            .font(.footnote)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(palette.surface, in: .rect(cornerRadius: 10))
        .task {
            try? await Task.sleep(for: .seconds(10))
            dismiss()
        }
    }
}

/// Messages waiting for the running turn, and held agent updates.
struct QueuedMessages: View {
    let chat: ChatStore
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var pending = false

    var body: some View {
        if !chat.queued.isEmpty || chat.held {
            VStack(spacing: 6) {
                ForEach(chat.queued, id: \.id) { message in
                    HStack(spacing: 8) {
                        Text("Queued: \(message.content)")
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        // The composer can't restore uploaded images, so those messages can only be removed.
                        if message.attachmentIds.isEmpty {
                            Button("Edit") {
                                act {
                                    try await chat.removeQueued(message)
                                    chat.draft.text = chat.draft.text.isEmpty ? message.content : "\(message.content)\n\(chat.draft.text)"
                                }
                            }
                        }
                        Button("Remove") { act { try await chat.removeQueued(message) } }
                    }
                }
                if chat.held {
                    HStack {
                        Text("Agent updates waiting").frame(maxWidth: .infinity, alignment: .leading)
                        Button("Deliver") { act { try await chat.deliver() } }
                    }
                }
            }
            .font(.footnote)
            .buttonStyle(.borderless)
            .disabled(pending)
            .padding(10)
            .background(palette.surface, in: .rect(cornerRadius: 12))
        }
    }

    private func act(_ work: @escaping () async throws -> Void) {
        Task {
            pending = true
            await session.notices.attempt(work)
            pending = false
        }
    }
}

extension Google_Protobuf_Struct {
    /// Indented JSON, as the web shows tool arguments.
    var prettyJSON: String {
        var options = JSONEncodingOptions()
        options.alwaysPrintEnumsAsInts = false
        guard let data = try? jsonUTF8Data(options: options),
              let object = try? JSONSerialization.jsonObject(with: data),
              let pretty = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        else { return "{}" }
        return String(decoding: pretty, as: UTF8.self)
    }
}

extension Google_Protobuf_Value {
    var boolValue: Bool? {
        if case .boolValue(let value) = kind { return value }
        return nil
    }
}
