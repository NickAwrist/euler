import Charts
import EulerAPI
import SwiftProtobuf
import SwiftUI

/// Usage insights: tokens and spend over time per model, provider totals, and
/// the per-model breakdown, from the same `GetUsage` the web reads.
struct UsageView: View {
    @Environment(AppSession.self) private var session
    @State private var days: UInt32 = 7
    @State private var metric = Metric.tokens
    @State private var providers: [String] = []
    @State private var page: UInt32 = 0
    @State private var asOf: Google_Protobuf_Timestamp?
    @State private var usage: Euler_V1_GetUsageResponse?
    @State private var error: String?

    enum Metric: String, CaseIterable {
        case tokens = "Tokens"
        case spend = "Spend"
    }

    var body: some View {
        ThemedList {
            Section {
                Picker("Date range", selection: $days) {
                    Text("24 hours").tag(UInt32(1))
                    Text("7 days").tag(UInt32(7))
                    Text("30 days").tag(UInt32(30))
                    Text("90 days").tag(UInt32(90))
                    Text("All time").tag(UInt32(0))
                }
            }
            if let usage {
                Section { totals(usage.totals) }
                Section {
                    Picker("Chart metric", selection: $metric) {
                        ForEach(Metric.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    UsageChart(chart: usage.chart, metric: metric)
                        .frame(height: 220)
                }
                Section("Providers") {
                    ForEach(usage.providers, id: \.key) { provider in
                        Button {
                            toggle(provider.key)
                        } label: {
                            HStack {
                                Image(systemName: providers.contains(provider.key) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(.tint)
                                VStack(alignment: .leading) {
                                    Text(provider.key.capitalized)
                                    Text(provider.modelCount == 1 ? "1 model" : "\(provider.modelCount) models")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text(Self.tokens(provider.totals.tokens)).foregroundStyle(.secondary)
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                }
                Section("Models") {
                    ForEach(usage.breakdown.rows, id: \.key) { row in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(row.key.replacingOccurrences(of: "openrouter:", with: "")).lineLimit(1)
                            HStack {
                                Text("\(Self.tokens(row.totals.tokens)) tokens")
                                Text("\(Int(row.tokenShare.rounded()))%")
                                Spacer()
                                Text(row.totals.hasCost ? Self.money(row.totals.cost) : "—")
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                    }
                    pager(usage.breakdown)
                }
            } else if let error {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Usage insights")
        .onChange(of: days) { page = 0 }
        .task(id: "\(days)|\(providers)|\(page)") { await load() }
        .refreshable {
            asOf = nil
            await load()
        }
    }

    @ViewBuilder
    private func totals(_ totals: Euler_V1_UsageTotals) -> some View {
        LabeledContent("Spend", value: totals.hasCost ? Self.money(totals.cost) : "—")
        LabeledContent("Tokens", value: Self.tokens(totals.tokens))
        LabeledContent("Calls", value: Int(totals.calls).formatted())
        if totals.hasCacheHitRate { LabeledContent("Cache hits", value: "\(Int(totals.cacheHitRate.rounded()))%") }
        if totals.hasSavings, totals.savings > 0 { LabeledContent("Cache savings", value: Self.money(totals.savings)) }
    }

    @ViewBuilder
    private func pager(_ breakdown: Euler_V1_GetUsageResponse.Breakdown) -> some View {
        let pages = max(1, (Int(breakdown.totalRows) + Int(breakdown.pageSize) - 1) / max(1, Int(breakdown.pageSize)))
        if pages > 1 {
            HStack {
                Button("Previous", systemImage: "chevron.left") { page -= 1 }.disabled(page == 0)
                Spacer()
                Text("\(page + 1) of \(pages)").font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("Next", systemImage: "chevron.right") { page += 1 }.disabled(Int(page) + 1 >= pages)
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
        }
    }

    private func toggle(_ provider: String) {
        if let index = providers.firstIndex(of: provider) { providers.remove(at: index) } else { providers.append(provider) }
        page = 0
    }

    private func load() async {
        var request = Euler_V1_GetUsageRequest()
        request.days = days
        request.providers = providers
        request.page = page
        request.sorting = [{
            var rule = Euler_V1_UsageSortRule()
            rule.column = .spend
            rule.descending = true
            return rule
        }()]
        // One cutoff for the page, so moving between filters compares the same window.
        if let asOf { request.asOf = asOf }
        do {
            let response = try await session.backend.usage.getUsage(request: request, headers: [:]).value()
            usage = response
            asOf = response.asOf
            error = nil
        } catch {
            self.error = error.displayMessage
        }
    }

    static func tokens(_ value: Double) -> String {
        value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
    }

    static func money(_ value: Double) -> String {
        value.formatted(.currency(code: "USD"))
    }
}

/// Stacked bars per time bucket, one series per model.
private struct UsageChart: View {
    let chart: Euler_V1_GetUsageResponse.Chart
    let metric: UsageView.Metric

    private struct Point: Identifiable {
        let id: String
        let date: Date
        let model: String
        let value: Double
    }

    var body: some View {
        let points = chart.series.flatMap { series in
            chart.buckets.indices.map { index in
                let values = metric == .tokens ? series.tokens : series.spend
                return Point(
                    id: "\(series.model)|\(index)",
                    date: chart.buckets[index].date,
                    model: series.model.replacingOccurrences(of: "openrouter:", with: ""),
                    value: values.indices.contains(index) ? values[index] : 0
                )
            }
        }
        if points.isEmpty {
            ContentUnavailableView("No usage in this range", systemImage: "chart.bar")
        } else {
            Chart(points) { point in
                BarMark(
                    x: .value("Date", point.date, unit: chart.intervalMs <= 3_600_000 ? .hour : .day),
                    y: .value(metric.rawValue, point.value)
                )
                .foregroundStyle(by: .value("Model", point.model))
            }
            .chartLegend(position: .bottom, alignment: .leading, spacing: 8)
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let number = value.as(Double.self) {
                            Text(metric == .tokens ? UsageView.tokens(number) : UsageView.money(number))
                        }
                    }
                }
            }
            .accessibilityLabel("\(metric.rawValue) by model over time")
        }
    }
}
