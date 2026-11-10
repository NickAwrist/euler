import EulerAPI
import SwiftProtobuf
import SwiftUI

/// A reply's execution trace: what the turn took in all, then each model call
/// and tool call as a card with what went in and what came back.
struct TraceView: View {
    let steps: [Euler_V1_Step]
    @Environment(\.palette) private var palette
    @State private var opened: TraceText?

    /// Steps the trace lists; the final "complete" marker says nothing on its own.
    static func displayed(_ steps: [Euler_V1_Step]) -> [Euler_V1_Step] {
        steps.filter { $0.kind == .llmCall || $0.kind == .toolCall || $0.kind == .error }
    }

    var body: some View {
        let shown = Self.displayed(steps)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                TraceSummary(steps: shown)
                    .padding(.bottom, 6)
                ForEach(shown.indices, id: \.self) { index in
                    TraceStepCard(step: shown[index], number: index + 1) { opened = $0 }
                }
            }
            .padding(16)
        }
        .background(palette.background)
        .navigationTitle("Execution Trace")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(item: $opened) { TraceTextView(content: $0) }
    }
}

/// Text too long for its card, opened on a page of its own.
private struct TraceText: Hashable, Identifiable {
    let title: String
    let text: String
    var monospaced = true

    var id: Self { self }
}

private struct TraceTextView: View {
    let content: TraceText
    @Environment(\.palette) private var palette

    var body: some View {
        SelectableText(
            text: content.text,
            monospaced: content.monospaced,
            color: UIColor(palette.foreground),
            tint: UIColor(palette.tint)
        )
        .ignoresSafeArea(edges: .bottom)
        .background(palette.background)
        .navigationTitle(content.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { CopyButton(text: content.text) } }
    }
}

private struct TraceSummary: View {
    let steps: [Euler_V1_Step]
    @Environment(\.palette) private var palette

    var body: some View {
        let calls = steps.filter { $0.kind == .llmCall && $0.hasMetrics }.map(\.metrics)
        let cost = calls.compactMap { $0.hasCost ? $0.cost : nil }.reduce(0, +)
        let input = calls.map { Int($0.promptTokens) }.reduce(0, +)
        let output = calls.map { Int($0.outputTokens) }.reduce(0, +)
        let duration = steps.compactMap(\.duration).reduce(0, +)
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 3), spacing: 8) {
            stat("Model calls", "\(steps.filter { $0.kind == .llmCall }.count)")
            stat("Tool calls", "\(steps.filter { $0.kind == .toolCall }.count)")
            if duration > 0 { stat("Time", Format.duration(milliseconds: duration)) }
            if input + output > 0 {
                stat("Tokens in", input.formatted(.number.notation(.compactName)))
                stat("Tokens out", output.formatted(.number.notation(.compactName)))
            }
            if cost > 0 { stat("Cost", cost.formatted(.currency(code: "USD").precision(.fractionLength(2...4)))) }
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.headline.monospacedDigit())
                .foregroundStyle(palette.foreground)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label).font(.caption).foregroundStyle(palette.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(palette.surface, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.borderSubtle))
        .accessibilityElement(children: .combine)
    }
}

/// One step: what ran and how long it took, then its thinking, arguments,
/// result and error, each in a block of its own.
private struct TraceStepCard: View {
    let step: Euler_V1_Step
    let number: Int
    let open: (TraceText) -> Void
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if step.hasThinking, !step.thinking.isEmpty {
                TraceBlock(label: "Thinking", copies: step.thinking) {
                    CappedText(title: "Thinking", text: step.thinking, monospaced: false, open: open)
                }
            }
            if step.hasArgs, !step.args.fields.isEmpty {
                TraceBlock(label: "Arguments", copies: step.args.prettyJSON) {
                    // Each argument under its name, so a command reads as typed rather than as escaped JSON.
                    ForEach(step.args.fields.keys.sorted(), id: \.self) { name in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name).font(typography.code(size: 11)).foregroundStyle(palette.muted)
                            CappedText(title: name, text: step.args.fields[name]?.displayText ?? "", open: open)
                        }
                    }
                }
            }
            if step.hasResult, !step.result.isEmpty {
                TraceBlock(label: "Result", copies: step.result) {
                    // A tool's output is set as code; a model's is what it wrote.
                    CappedText(title: "Result", text: step.result, monospaced: step.kind == .toolCall, open: open)
                }
            }
            if step.hasError {
                Text(step.error)
                    .font(.footnote)
                    .foregroundStyle(Color(hex: 0xFCA5A5))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Color.red.opacity(0.1), in: .rect(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.red.opacity(0.3)))
            }
            if let metrics {
                Text(metrics).font(.caption.monospacedDigit()).foregroundStyle(palette.muted)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.surface, in: .rect(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(step.status == .error ? Color.red.opacity(0.35) : palette.borderSubtle))
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text("\(number)")
                .font(.caption2.weight(.semibold).monospacedDigit())
                .foregroundStyle(palette.muted)
                .frame(minWidth: 22, minHeight: 22)
                .background(palette.fill, in: .rect(cornerRadius: 6))
                .accessibilityHidden(true)
            icon.font(.footnote)
            Text(title)
                .font(step.kind == .toolCall ? typography.code(size: 14).weight(.semibold) : .subheadline.weight(.semibold))
                .foregroundStyle(palette.foreground)
                .lineLimit(1)
            if step.kind == .llmCall, step.hasAgentName { chip(step.agentName) }
            if step.hasJobID { chip("Background job") }
            Spacer(minLength: 4)
            if step.status == .running {
                ProgressView().controlSize(.small).accessibilityLabel("Running")
            } else if let duration = step.duration {
                Text(Format.duration(milliseconds: duration))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(palette.muted)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .foregroundStyle(palette.muted)
            .lineLimit(1)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(palette.borderSubtle))
    }

    private var title: String {
        switch step.kind {
        case .toolCall: step.toolName
        case .llmCall: "Model call"
        case .error: "Error"
        default: "Step"
        }
    }

    @ViewBuilder
    private var icon: some View {
        if step.status == .error || step.kind == .error {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
        } else if step.kind == .toolCall {
            // A plug for an MCP server's tool, as on the web.
            Image(systemName: step.toolName.hasPrefix("mcp__") ? "powerplug" : "wrench.and.screwdriver").foregroundStyle(palette.muted)
        } else {
            Image(systemName: "sparkles").foregroundStyle(palette.muted)
        }
    }

    /// A model call's tokens, speed and cost on one line.
    private var metrics: String? {
        guard step.hasMetrics else { return nil }
        let metrics = step.metrics
        var parts: [String] = []
        if metrics.hasPromptTokens { parts.append("\(metrics.promptTokens.formatted()) in") }
        if metrics.hasCachedTokens { parts.append("\(metrics.cachedTokens.formatted()) cached") }
        if metrics.hasOutputTokens { parts.append("\(metrics.outputTokens.formatted()) out") }
        if metrics.hasTokensPerSecond { parts.append("\(Int(metrics.tokensPerSecond)) tok/s") }
        if metrics.hasCost { parts.append(metrics.cost.formatted(.currency(code: "USD").precision(.fractionLength(2...5)))) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// A labeled, inset block of a step's text with a button to copy all of it.
private struct TraceBlock<Content: View>: View {
    let label: String
    let copies: String
    @ViewBuilder let content: Content
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label)
                    .font(.caption2.weight(.semibold))
                    .textCase(.uppercase)
                    .tracking(0.8)
                    .foregroundStyle(palette.muted)
                Spacer()
                CopyButton(text: copies, label: "Copy \(label.lowercased())")
                    .frame(height: 16)
            }
            content
        }
        .padding(.leading, 10)
        .padding(.trailing, 4)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.background, in: .rect(cornerRadius: 10))
    }
}

/// Text held to a few lines in its card; longer text opens on its own page,
/// where any part of it can be selected.
private struct CappedText: View {
    let title: String
    let text: String
    var monospaced = true
    let open: (TraceText) -> Void
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography

    private static let lines = 10

    var body: some View {
        let count = text.split(separator: "\n", omittingEmptySubsequences: false).count
        VStack(alignment: .leading, spacing: 6) {
            Text(text)
                .font(monospaced ? typography.code(size: 12.5) : .footnote)
                .foregroundStyle(palette.foreground.opacity(monospaced ? 1 : 0.8))
                .lineLimit(Self.lines)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            // Wrapped lines count too, so long text on few lines also opens.
            if count > Self.lines || text.count > 600 {
                Button {
                    open(TraceText(title: title, text: text, monospaced: monospaced))
                } label: {
                    HStack(spacing: 4) {
                        Text(count > Self.lines ? "Show all \(count) lines" : "Show all")
                        Image(systemName: "chevron.right").font(.caption2)
                    }
                    .font(.caption.weight(.medium))
                    .foregroundStyle(palette.tint)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.trailing, 6)
    }
}

extension Euler_V1_Step {
    /// How long the step ran, once it has ended.
    var duration: Double? {
        hasEndedAt ? max(0, endedAt.milliseconds - startedAt.milliseconds) : nil
    }
}
