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
                Picker("Date range", selection: $days.ticking()) {
                    Text("24 hours").tag(UInt32(1))
                    Text("7 days").tag(UInt32(7))
                    Text("30 days").tag(UInt32(30))
                    Text("90 days").tag(UInt32(90))
                    Text("All time").tag(UInt32(0))
                }
                .mutedPickerValue()
            }
            if let usage {
                Section { totals(usage.totals) }
                Section {
                    Picker("Chart metric", selection: $metric.ticking()) {
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

    /// Fractions of a cent keep up to four places, as on the web.
    static func money(_ value: Double) -> String {
        value.formatted(.currency(code: "USD").precision(.fractionLength(value > 0 && value < 0.01 ? 2...4 : 2...2)))
    }
}

/// Stacked bars per time bucket, one series per model. Tapping a bucket shows
/// its values per model, as hovering does on the web.
private struct UsageChart: View {
    let chart: Euler_V1_GetUsageResponse.Chart
    let metric: UsageView.Metric
    /// The start of the bucket whose values are shown.
    @State private var selected: Date?
    @Environment(\.palette) private var palette

    private struct Point: Identifiable {
        let id: String
        let bucket: Int
        let date: Date
        let model: String
        let value: Double
    }

    private var unit: Calendar.Component { chart.intervalMs <= 3_600_000 ? .hour : .day }

    private var points: [Point] {
        chart.series.flatMap { series in
            chart.buckets.indices.map { index in
                let values = metric == .tokens ? series.tokens : series.spend
                return Point(
                    id: "\(series.model)|\(index)",
                    bucket: index,
                    date: chart.buckets[index].date,
                    model: series.model.replacingOccurrences(of: "openrouter:", with: ""),
                    value: values.indices.contains(index) ? values[index] : 0
                )
            }
        }
    }

    var body: some View {
        let points = points
        let shown = selected.flatMap { date in chart.buckets.firstIndex { $0.date == date } }
        if points.isEmpty {
            ContentUnavailableView("No usage in this range", systemImage: "chart.bar")
        } else {
            Chart(points) { point in
                BarMark(
                    x: .value("Date", point.date, unit: unit),
                    y: .value(metric.rawValue, point.value)
                )
                .foregroundStyle(by: .value("Model", point.model))
                .opacity(shown == nil || shown == point.bucket ? 1 : 0.3)
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
            .chartOverlay { proxy in
                GeometryReader { geometry in
                    if let anchor = proxy.plotFrame {
                        let plot = geometry[anchor]
                        // The whole column is the target, not only the bar drawn in it.
                        Color.clear
                            .contentShape(.rect)
                            .onTapGesture { location in select(atX: location.x - plot.minX, proxy) }
                        if let shown {
                            let leading = (proxy.position(forX: chart.buckets[shown].date) ?? 0) > plot.width / 2
                            readout(shown, points: points, proxy)
                                .frame(width: plot.width, height: plot.height, alignment: leading ? .topLeading : .topTrailing)
                                .offset(x: plot.minX, y: plot.minY)
                                .allowsHitTesting(false)
                        }
                    }
                }
            }
            .animation(.easeOut(duration: 0.15), value: shown)
            .sensoryFeedback(.selection, trigger: selected)
            .accessibilityLabel("\(metric.rawValue) by model over time")
        }
    }

    /// Shows the bucket under `x`, or clears it when tapped again or outside any bucket.
    private func select(atX x: CGFloat, _ proxy: ChartProxy) {
        let tapped: Date? = proxy.value(atX: x)
        let bucket = tapped.flatMap { date in
            chart.buckets.first { Calendar.current.isDate(date, equalTo: $0.date, toGranularity: unit) }?.date
        }
        selected = bucket == selected ? nil : bucket
    }

    /// The bucket's date and each model's value in it, largest first.
    private func readout(_ bucket: Int, points: [Point], _ proxy: ChartProxy) -> some View {
        let rows = points.filter { $0.bucket == bucket && $0.value > 0 }.sorted { $0.value > $1.value }
        let date = chart.buckets[bucket].date
        return Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 5) {
            Text(unit == .hour ? date.formatted(.dateTime.month(.abbreviated).day().hour()) : date.formatted(.dateTime.month(.abbreviated).day()))
                .fontWeight(.semibold)
                .foregroundStyle(palette.foreground)
                .gridCellColumns(2)
            if rows.isEmpty {
                Text("No usage").foregroundStyle(palette.muted).gridCellColumns(2)
            }
            ForEach(rows.prefix(Self.readoutRows)) { row in
                readoutRow(row.model, value: row.value, key: proxy.foregroundStyle(for: row.model))
            }
            if rows.count > Self.readoutRows {
                readoutRow("\(rows.count - Self.readoutRows) more", value: rows.dropFirst(Self.readoutRows).reduce(0) { $0 + $1.value }, key: nil)
            }
            if rows.count > 1 {
                Rectangle().fill(palette.borderSubtle).frame(height: 1).gridCellColumns(2).gridCellUnsizedAxes(.horizontal)
                readoutRow("Total", value: rows.reduce(0) { $0 + $1.value }, key: nil)
            }
        }
        .font(.caption)
        .padding(10)
        .frame(maxWidth: 240)
        .fixedSize()
        .background(palette.background.opacity(0.94), in: .rect(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette.border))
        .padding(4)
        .accessibilityElement(children: .combine)
    }

    private static let readoutRows = 4

    /// A short stroke in the series color, the model, and its exact value.
    private func readoutRow(_ name: String, value: Double, key: AnyShapeStyle?) -> some View {
        GridRow {
            HStack(spacing: 6) {
                Capsule().fill(key ?? AnyShapeStyle(.clear)).frame(width: 3, height: 11)
                Text(name).foregroundStyle(palette.muted).lineLimit(1).truncationMode(.middle)
            }
            Text(metric == .tokens ? value.formatted(.number.precision(.fractionLength(0))) : UsageView.money(value))
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(palette.foreground)
                .fixedSize()
                .gridColumnAlignment(.trailing)
        }
    }
}
