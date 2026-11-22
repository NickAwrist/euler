import EulerAPI
import SwiftUI

/// OpenRouter or Vercel AI Gateway: the API key, credits, and which publishers' models appear in the composer.
struct OpenRouterSettingsView: View {
    var provider: Euler_V1_ModelProvider = .openrouter
    @Environment(AppSession.self) private var session
    @State private var store: GatewayCatalogStore?

    private var apiKeyProvider: Euler_V1_ApiKeyProvider {
        provider == .vercelGateway ? .vercelGateway : .openrouter
    }

    private var title: String {
        provider == .vercelGateway ? "Vercel AI Gateway" : "OpenRouter"
    }

    var body: some View {
        ThemedForm {
            ApiKeySection(provider: apiKeyProvider, title: "API key") {
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
        .navigationTitle(title)
        .toolbar {
            if let store, store.hasKey {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh catalog", systemImage: "arrow.clockwise") { Task { await store.refresh() } }
                        .disabled(store.refreshing)
                }
            }
        }
        .task {
            let store = store ?? GatewayCatalogStore(session: session, provider: provider)
            self.store = store
            await store.load()
        }
    }
}

/// The catalog, balance and choices shared by OpenRouter and Vercel AI Gateway settings pages.
@Observable
final class GatewayCatalogStore {
    let provider: Euler_V1_ModelProvider
    private(set) var catalog: Euler_V1_ModelCatalog?
    private(set) var balance: Euler_V1_GetProviderBalanceResponse?
    private(set) var balanceError: String?
    private(set) var hasKey = false
    private(set) var refreshing = false
    @ObservationIgnored private let session: AppSession

    init(session: AppSession, provider: Euler_V1_ModelProvider) {
        self.session = session
        self.provider = provider
    }

    var title: String { provider == .vercelGateway ? "Vercel AI Gateway" : "OpenRouter" }
    var hasKeyAllowance: Bool { provider == .openrouter }
    private var apiKeyProvider: Euler_V1_ApiKeyProvider { provider == .vercelGateway ? .vercelGateway : .openrouter }
    private var providers: any Euler_V1_ProviderServiceClientInterface { session.backend.providers }

    func load() async {
        var request = Euler_V1_GetApiKeyRequest()
        request.provider = apiKeyProvider
        hasKey = (try? await providers.getApiKey(request: request, headers: [:]).value().state.hasKey_p) ?? false
        guard hasKey else { return }
        var catalogRequest = Euler_V1_GetModelCatalogRequest()
        catalogRequest.provider = provider
        async let catalog = providers.getModelCatalog(request: catalogRequest, headers: [:]).value()
        async let balance: Void = loadBalance()
        self.catalog = try? await catalog.catalog
        await balance
    }

    func loadBalance() async {
        do {
            var request = Euler_V1_GetProviderBalanceRequest()
            request.provider = provider
            balance = try await providers.getProviderBalance(request: request, headers: [:]).value()
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
            var request = Euler_V1_RefreshModelCatalogRequest()
            request.provider = provider
            catalog = try await providers.refreshModelCatalog(request: request, headers: [:]).value().catalog
        }
        await session.models.load()
    }

    func models(_ publisherID: String) -> [Euler_V1_CatalogModel] {
        catalog?.modelsByPublisher[publisherID]?.models ?? []
    }

    /// Runs a change, then reloads the catalog and the composer's models.
    func change(_ work: (any Euler_V1_ProviderServiceClientInterface) async throws -> Void) async {
        let ok = await session.notices.attempt { try await work(providers) }
        if ok { Haptics.light() }
        var catalogRequest = Euler_V1_GetModelCatalogRequest()
        catalogRequest.provider = provider
        catalog = try? await providers.getModelCatalog(request: catalogRequest, headers: [:]).value().catalog
        await session.models.load()
    }
}

private struct BalanceSection: View {
    let store: GatewayCatalogStore

    var body: some View {
        Section {
            if let balance = store.balance {
                LabeledContent("Credits", value: balance.hasAccountBalance ? money(balance.accountBalance) : "Unavailable for this key")
                if store.hasKeyAllowance {
                    LabeledContent("Key limit", value: balance.hasKeyLimit ? money(balance.keyLimit) : "No spending limit")
                    if balance.hasKeyRemaining { LabeledContent("Remaining", value: money(balance.keyRemaining)) }
                }
                LabeledContent("Used", value: money(balance.keyUsage))
            } else if let error = store.balanceError {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView()
            }
            Button("Refresh balance", systemImage: "arrow.clockwise") { Task { await store.loadBalance() } }
        } header: {
            Text("\(store.title) credits")
        }
    }

    private func money(_ value: Double) -> String {
        value.formatted(.currency(code: "USD"))
    }
}

private struct PublishersSection: View {
    let store: GatewayCatalogStore
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
                    .sheet(isPresented: $adding) { AddPublisherSheet(store: store) }
            } else {
                ProgressView()
            }
        } header: {
            Text("Publishers")
        }
    }
}

private struct PublisherView: View {
    let store: GatewayCatalogStore
    let publisherID: String
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        let publisher = store.catalog?.publishers.first { $0.id == publisherID }
        let models = store.models(publisherID).filter {
            search.isEmpty || $0.name.localizedCaseInsensitiveContains(search) || $0.route.localizedCaseInsensitiveContains(search)
        }
        ThemedList {
            if let publisher {
                Section {
                    Toggle("Auto-enable new models", isOn: Binding(
                        get: { publisher.subscribed },
                        set: { subscribed in
                            Task {
                                await store.change { providers in
                                    var request = Euler_V1_SetCatalogSubscriptionRequest()
                                    request.provider = store.provider
                                    request.publisherID = publisherID
                                    request.subscribed = subscribed
                                    _ = try await providers.setCatalogSubscription(request: request, headers: [:]).value()
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
                                var request = Euler_V1_RemoveCatalogPublisherRequest()
                                request.provider = store.provider
                                request.publisherID = publisherID
                                _ = try await providers.removeCatalogPublisher(request: request, headers: [:]).value()
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
    let store: GatewayCatalogStore
    let model: Euler_V1_CatalogModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: Binding(
                get: { model.enabled },
                set: { enabled in
                    Task {
                        await store.change { providers in
                            var request = Euler_V1_SetCatalogModelEnabledRequest()
                            request.provider = store.provider
                            request.route = model.route
                            request.enabled = enabled
                            _ = try await providers.setCatalogModelEnabled(request: request, headers: [:]).value()
                        }
                    }
                }
            )) {
                HStack(spacing: 6) {
                    Text(model.name)
                    if model.isNew { NewBadge() }
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
    let store: GatewayCatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var search = ""

    var body: some View {
        NavigationStack {
            ThemedList {
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
                                        var request = Euler_V1_TrackCatalogPublisherRequest()
                                        request.provider = store.provider
                                        request.publisherID = publisher.id
                                        _ = try await providers.trackCatalogPublisher(request: request, headers: [:]).value()
                                    }
                                }
                            }
                            .buttonStyle(.bordered)
                            .buttonBorderShape(.capsule)
                        }
                    }
                }
            }
            .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always))
            .navigationTitle("Add publisher")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { CloseToolbarItem { dismiss() } }
        }
    }
}
