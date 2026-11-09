import EulerAPI
import SwiftUI

/// A reply's execution trace: each model call and tool call, with timing,
/// tokens and cost, and the arguments and results behind them.
struct TraceView: View {
    let steps: [Euler_V1_Step]
    @Environment(\.dismiss) private var dismiss

    /// Steps the trace lists; the final "complete" marker says nothing on its own.
    static func displayed(_ steps: [Euler_V1_Step]) -> [Euler_V1_Step] {
        steps.filter { $0.kind == .llmCall || $0.kind == .toolCall || $0.kind == .error }
    }

    var body: some View {
        let shown = Self.displayed(steps)
        ThemedList {
            Section { TraceSummary(steps: shown) }
            Section("Steps") { TraceSteps(steps: shown) }
        }
        .navigationTitle("Execution Trace")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
}

private struct TraceSummary: View {
    let steps: [Euler_V1_Step]

    var body: some View {
        let calls = steps.filter { $0.kind == .llmCall && $0.hasMetrics }.map(\.metrics)
        let cost = calls.compactMap { $0.hasCost ? $0.cost : nil }.reduce(0, +)
        let input = calls.map { Int($0.promptTokens) }.reduce(0, +)
        let output = calls.map { Int($0.outputTokens) }.reduce(0, +)
        let duration = steps.compactMap { step -> Double? in
            guard step.hasEndedAt else { return nil }
            return step.endedAt.milliseconds - step.startedAt.milliseconds
        }.reduce(0, +)
        LabeledContent("Model calls", value: "\(steps.filter { $0.kind == .llmCall }.count)")
        LabeledContent("Tool calls", value: "\(steps.filter { $0.kind == .toolCall }.count)")
        if input + output > 0 {
            LabeledContent("Tokens", value: "\(input.formatted()) in · \(output.formatted()) out")
        }
        if cost > 0 { LabeledContent("Cost", value: cost.formatted(.currency(code: "USD").precision(.fractionLength(2...4)))) }
        if duration > 0 { LabeledContent("Time", value: Format.duration(milliseconds: duration)) }
    }
}

/// Each step as a disclosure row.
struct TraceSteps: View {
    let steps: [Euler_V1_Step]

    var body: some View {
        ForEach(steps.indices, id: \.self) { index in
            TraceStepRow(step: steps[index])
        }
    }
}

private struct TraceStepRow: View {
    let step: Euler_V1_Step

    var body: some View {
        DisclosureGroup {
            if step.hasArgs {
                Text(step.args.prettyJSON).font(.caption.monospaced()).textSelection(.enabled)
            }
            if step.hasThinking, !step.thinking.isEmpty {
                Text(step.thinking).font(.footnote).foregroundStyle(.secondary).textSelection(.enabled)
            }
            if step.hasResult, !step.result.isEmpty {
                Text(step.result).font(.caption.monospaced()).lineLimit(40).textSelection(.enabled)
            }
            if step.hasError {
                Text(step.error).font(.footnote).foregroundStyle(.red)
            }
            if step.hasMetrics { metrics(step.metrics) }
        } label: {
            HStack(spacing: 8) {
                icon
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).lineLimit(1)
                    if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                }
            }
        }
    }

    private var title: String {
        switch step.kind {
        case .toolCall: step.toolName
        case .llmCall: step.hasAgentName ? "\(step.agentName) · Model call" : "Model call"
        case .error: "Error"
        default: "Step"
        }
    }

    private var detail: String? {
        var parts: [String] = []
        if step.hasEndedAt { parts.append(Format.duration(milliseconds: step.endedAt.milliseconds - step.startedAt.milliseconds)) }
        if step.status == .running { parts.append("Running") }
        if step.hasJobID { parts.append("Background job") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    @ViewBuilder
    private var icon: some View {
        switch step.status {
        case .running: ProgressView().controlSize(.small)
        case .error: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
        default: Image(systemName: step.kind == .toolCall ? "wrench.and.screwdriver" : "sparkles").foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func metrics(_ metrics: Euler_V1_LlmMetrics) -> some View {
        if metrics.hasPromptTokens { LabeledContent("Input tokens", value: metrics.promptTokens.formatted()) }
        if metrics.hasCachedTokens { LabeledContent("Cached tokens", value: metrics.cachedTokens.formatted()) }
        if metrics.hasOutputTokens { LabeledContent("Output tokens", value: metrics.outputTokens.formatted()) }
        if metrics.hasTokensPerSecond { LabeledContent("Speed", value: "\(Int(metrics.tokensPerSecond)) tok/s") }
        if metrics.hasCost { LabeledContent("Cost", value: metrics.cost.formatted(.currency(code: "USD").precision(.fractionLength(2...5)))) }
    }
}
