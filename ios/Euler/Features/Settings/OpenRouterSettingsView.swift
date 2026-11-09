import EulerAPI
import SwiftUI

/// OpenRouter: the API key, credits, and which publishers' models appear in the composer.
struct OpenRouterSettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var store: OpenRouterStore?

    var body: some View {
        Form {
            ApiKeySection(provider: .openrouter, title: "API key") {
                await store?.load()
                await session.models.load()
            }
            if let store {
                if store.hasKey {
                    BalanceSection(store: store)
                    PublishersSection(store: store)
                }
            }
        }
        .navigationTitle("OpenRouter")
        .toolbar {
            if let store, store.hasKey {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh catalog", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
                        .disabled(store.refreshing)
                }
            }
        }
        .task {
            let store = store ?? OpenRouterStore(session: session)
            self.store = store
            await store.load()
        }
    }
}

/// The catalog, balance and choices the OpenRouter pages share.
@Observable
final class OpenRouterStore {
    private(set) var catalog: Euler_V1_OpenRouterCatalog?
    private(set) var balance: Euler_V1_GetOpenRouterBalanceResponse?
    private(set) var balanceError: String?
    private(set) var hasKey = false
    private(set) var refreshing = false
    @ObservationIgnored private let session: AppSession

    init(session: AppSession) {
        self.session = session
    }

    private var providers: any Euler_V1_ProviderServiceClientInterface { session.backend.providers }

    func load() async {
        var request = Euler_V1_GetApiKeyRequest()
        request.provider = .openrouter
        hasKey = (try? await providers.getApiKey(request: request, headers: [:]).value().state.hasKey_p) ?? false
        guard hasKey else { return }
        async let catalog = providers.getOpenRouterCatalog(request: .init(), headers: [:]).value()
        async let balance: Void = loadBalance()
        self.catalog = try? await catalog.catalog
        await balance
    }

    func loadBalance() async {
        do {
            balance = try await providers.getOpenRouterBalance(request: .init(), headers: [:]).value()
            balanceError = nil
        } catch {
            balance = nil
            balanceError = "Could not load credits."
        }
    }

    func refresh() async {
        refreshing = true
        defer { refreshing = false }
        await session.notices.attempt {
            catalog = try await providers.refreshOpenRouterCatalog(request: .init(), headers: [:]).value().catalog
        }
        await session.models.load()
    }

    func models(_ publisherID: String) -> [Euler_V1_OpenRouterModel] {
        catalog?.modelsByPublisher[publisherID]?.models ?? []
    }

    /// Runs a change, then reloads the catalog and the composer's models.
    func change(_ work: (any Euler_V1_ProviderServiceClientInterface) async throws -> Void) async {
        let ok = await session.notices.attempt { try await work(providers) }
        if ok { Haptics.light() }
        catalog = try? await providers.getOpenRouterCatalog(request: .init(), headers: [:]).value().catalog
        await session.models.load()
    }
}

private struct BalanceSection: View {
    let store: OpenRouterStore

    var body: some View {
        Section {
            if let balance = store.balance {
                LabeledContent("Credits", value: balance.hasAccountBalance ? money(balance.accountBalance) : "Unavailable for this key")
                LabeledContent("Key limit", value: balance.hasKeyLimit ? money(balance.keyLimit) : "No spending limit")
                if balance.hasKeyRemaining { LabeledContent("Remaining", value: money(balance.keyRemaining)) }
                LabeledContent("Used", value: money(balance.keyUsage))
            } else if let error = store.balanceError {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView()
            }
            Button("Refresh balance") { Task { await store.loadBalance() } }
        } header: {
            Text("OpenRouter credits")
        }
    }

    private func money(_ value: Double) -> String {
        value.formatted(.currency(code: "USD"))
    }
}

private struct PublishersSection: View {
    let store: OpenRouterStore
    @State private var adding = false

    var body: some View {
        Section {
            if let catalog = store.catalog {
                if catalog.freshness.status != .fresh {
                    Text(catalog.freshness.status == .stale
                         ? "Refresh failed. Showing the last known catalog."
                         : "No cached catalog. Saved choices remain visible with unverified availability.")
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }
                ForEach(catalog.publishers.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }, id: \.id) { publisher in
                    NavigationLink {
                        PublisherView(store: store, publisherID: publisher.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(publisher.name)
                            Text("\(publisher.enabledCount) enabled" + (publisher.hasRecentCount && publisher.recentCount > 0 ? " · \(publisher.recentCount) new" : ""))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Button("Add publisher", systemImage: "plus") { adding = true }
            } else {
                ProgressView()
            }
        } header: {
            Text("Publishers")
        }
        .sheet(isPresented: $adding) { AddPublisherSheet(store: store) }
    }
}

private struct PublisherView: View {
    let store: OpenRouterStore
    let publisherID: String
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        let publisher = store.catalog?.publishers.first { $0.id == publisherID }
        let models = store.models(publisherID).filter {
            search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.route.localizedCaseInsensitiveContains(search)
        }
        List {
            if let publisher {
                Section {
                    Toggle("Auto-enable new models", isOn: Binding(
                        get: { publisher.subscribed },
                        set: { subscribed in
                            Task {
                                await store.change { providers in
                                    var request = Euler_V1_SetOpenRouterSubscriptionRequest()
                                    request.publisherID = publisherID
                                    request.subscribed = subscribed
                                    _ = try await providers.setOpenRouterSubscription(request: request, headers: [:]).value()
                                }
                            }
                        }
                    ))
                }
            }
            Section {
                if models.isEmpty { Text("No matching interactive models.").foregroundStyle(.secondary) }
                ForEach(models, id: \.route) { model in
                    ModelRow(store: store, model: model)
                }
            }
            if publisher != nil {
                Section {
                    Button("Remove publisher", role: .destructive) {
                        Task {
                            await store.change { providers in
                                var request = Euler_V1_RemoveOpenRouterPublisherRequest()
                                request.publisherID = publisherID
                                _ = try await providers.removeOpenRouterPublisher(request: request, headers: [:]).value()
                            }
                            dismiss()
                        }
                    }
                }
            }
        }
        .searchable(text: $search)
        .navigationTitle(publisher?.name ?? publisherID)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ModelRow: View {
    let store: OpenRouterStore
    let model: Euler_V1_OpenRouterModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: Binding(
                get: { model.enabled },
                set: { enabled in
                    Task {
                        await store.change { providers in
                            var request = Euler_V1_SetOpenRouterModelEnabledRequest()
                            request.route = model.route
                            request.enabled = enabled
                            _ = try await providers.setOpenRouterModelEnabled(request: request, headers: [:]).value()
                        }
                    }
                }
            )) {
                HStack(spacing: 6) {
                    Text(model.name)
                    if model.isNew { Text("New").font(.caption2).padding(.horizontal, 5).background(.tint.opacity(0.3), in: .capsule) }
                }
            }
            .disabled(model.availability == .unavailable && !model.enabled)
            Text(details).font(.caption).foregroundStyle(.secondary)
        }
        .accessibilityLabel("Enable \(model.name)")
    }

    private var details: String {
        var parts = [model.route]
        if model.hasContextLength { parts.append("\(model.contextLength / 1000)K context") }
        if model.hasPromptPricePerMillion, model.hasCompletionPricePerMillion {
            parts.append("$\(model.promptPricePerMillion.formatted()) in / $\(model.completionPricePerMillion.formatted()) out")
        }
        switch model.availability {
        case .unavailable: parts.append("Unavailable")
        case .unverified: parts.append("Availability unverified")
        default: break
        }
        return parts.joined(separator: " · ")
    }
}

private struct AddPublisherSheet: View {
    let store: OpenRouterStore
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        NavigationStack {
            List {
                let publishers = (store.catalog?.discoveredPublishers.publishers ?? []).filter {
                    search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.id.localizedCaseInsensitiveContains(search)
                }
                ForEach(publishers, id: \.id) { publisher in
                    HStack {
                        Text(publisher.name)
                        Spacer()
                        if publisher.tracked {
                            Text("Added").foregroundStyle(.secondary)
                        } else {
                            Button("Add") {
                                Task {
                                    await store.change { providers in
                                        var request = Euler_V1_TrackOpenRouterPublisherRequest()
                                        request.publisherID = publisher.id
                                        _ = try await providers.trackOpenRouterPublisher(request: request, headers: [:]).value()
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Add publisher")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
