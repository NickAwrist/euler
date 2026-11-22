import EulerAPI
import SwiftUI

/// Ollama: the server's address, a connection test, its state, and the context window.
struct OllamaSettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var host = ""
    @State private var config: Euler_V1_HostConfig?
    @State private var contextWindow = Euler_V1_OllamaContextWindow.low
    @State private var health: Euler_V1_GetOllamaHealthResponse?

    var body: some View {
        let managed = session.preferences.environment.ollamaHost
        ThemedForm {
            HostSection(
                title: "Server URL",
                placeholder: "http://127.0.0.1:11434",
                host: $host,
                config: config,
                managed: managed,
                connected: health?.connected,
                test: { host in
                    var request = Euler_V1_TestOllamaHostRequest()
                    request.host = host
                    return try await session.backend.providers.testOllamaHost(request: request, headers: [:]).value().result
                },
                save: { host in
                    var request = Euler_V1_UpdateOllamaConfigRequest()
                    request.host = host
                    config = try await session.backend.providers.updateOllamaConfig(request: request, headers: [:]).value().config
                    await session.models.load()
                    await loadHealth()
                }
            )
            Section {
                Picker("Context window", selection: contextWindowBinding) {
                    ForEach(Self.contextWindows, id: \.0) { window, name in Text(name).tag(window) }
                }
                .mutedPickerValue()
                .disabled(config == nil)
            }
        }
        .navigationTitle("Ollama")
        .task {
            if let response = try? await session.backend.providers.getOllamaConfig(request: .init(), headers: [:]).value() {
                config = response.config
                host = response.config.host.isEmpty ? response.config.effectiveHost : response.config.host
                contextWindow = response.contextWindow
            }
            await loadHealth()
        }
    }

    static let contextWindows: [(Euler_V1_OllamaContextWindow, String)] = [
        (.low, "Low - 32k"), (.medium, "Medium - 128k"), (.high, "High - 256k"),
    ]

    /// The saved choice, with a setter that saves and goes back to it on failure.
    private var contextWindowBinding: Binding<Euler_V1_OllamaContextWindow> {
        Binding(
            get: { contextWindow },
            set: { value in
                Haptics.select()
                let saved = contextWindow
                contextWindow = value
                Task {
                    var request = Euler_V1_SetOllamaContextWindowRequest()
                    request.contextWindow = value
                    let ok = await session.notices.attempt {
                        contextWindow = try await session.backend.providers.setOllamaContextWindow(request: request, headers: [:]).value().contextWindow
                    }
                    if !ok { contextWindow = saved }
                }
            }
        )
    }

    private func loadHealth() async {
        health = try? await session.backend.providers.getOllamaHealth(request: .init(), headers: [:]).value()
    }
}

/// An address with its connection state beside it, and Test and Save under
/// both. Read-only when the environment sets the address.
struct HostSection: View {
    let title: String
    let placeholder: String
    @Binding var host: String
    let config: Euler_V1_HostConfig?
    let managed: Bool
    let connected: Bool?
    let test: (String) async throws -> Euler_V1_HostTest
    let save: (String) async throws -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var result: String?
    @State private var resultOK = false
    @State private var testing = false
    @State private var saving = false
    /// The address a result belongs to; editing it hides a stale result.
    @State private var testedHost = ""

    private var trimmed: String { host.trimmingCharacters(in: .whitespaces) }
    /// The address in use: the saved one, or the server's default.
    private var current: String {
        guard let config else { return "" }
        return config.host.isEmpty ? config.effectiveHost : config.host
    }

    var body: some View {
        Section {
            TextField(placeholder, text: $host)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(managed)
                .accessibilityLabel(title)
            status
        } header: {
            Text(title)
        } footer: {
            if managed { Text("Managed by the environment.") }
        }
        FormActions {
            Button("Test") { Task { await runTest() } }
                .disabled(testing || trimmed.isEmpty)
            if !managed {
                Button("Save") { Task { await runSave() } }
                    .buttonStyle(FormActionStyle(prominent: true))
                    .disabled(saving || host == current || trimmed.isEmpty)
            }
        }
    }

    /// The latest test of this address, or what the server last said of the saved one.
    @ViewBuilder
    private var status: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if testing {
                ProgressView().controlSize(.small)
                Text("Testing").foregroundStyle(palette.muted)
            } else if let result, testedHost == host {
                StatusDot(color: resultOK ? Palette.positive : .red)
                Text(result).foregroundStyle(resultOK ? palette.foreground : Color.red)
            } else if let connected, host == current {
                StatusDot(color: connected ? Palette.positive : palette.muted)
                Text(connected ? "Connected" : "Not connected").foregroundStyle(connected ? palette.foreground : palette.muted)
            } else {
                StatusDot(color: palette.muted)
                Text("Not tested").foregroundStyle(palette.muted)
            }
        }
        .font(.subheadline)
        .accessibilityElement(children: .combine)
    }

    private func runSave() async {
        saving = true
        defer { saving = false }
        if await session.notices.attempt({ try await save(trimmed) }) {
            session.notices.success("Saved.")
        }
    }

    private func runTest() async {
        testing = true
        defer { testing = false }
        let tested = host
        do {
            let outcome = try await test(tested.trimmingCharacters(in: .whitespaces))
            // A result for an address since edited is ignored.
            guard tested == host else { return }
            resultOK = outcome.ok
            result = outcome.ok
                ? "Connected" + (outcome.hasVersion ? " - version \(outcome.version)" : "")
                : (outcome.hasError ? outcome.error : "Connection failed")
            testedHost = tested
        } catch {
            guard tested == host else { return }
            resultOK = false
            result = error.displayMessage
            testedHost = tested
        }
    }
}

/// The small dot beside a connection's state.
struct StatusDot: View {
    let color: Color

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 7, height: 7)
            // Sits at the middle of a line of text beside it, even when that text wraps.
            .alignmentGuide(.firstTextBaseline) { $0[.bottom] + 3 }
            .accessibilityHidden(true)
    }
}

/// An API key the server stores: Update, Remove, or read-only from the environment.
struct ApiKeySection: View {
    let provider: Euler_V1_ApiKeyProvider
    let title: String
    var onChange: () async -> Void = {}
    @Environment(AppSession.self) private var session
    @State private var state: Euler_V1_ApiKeyState?
    @State private var editing = false
    @State private var key = ""
    @State private var confirmingRemove = false

    /// Whether the field for a new key shows, rather than the saved key's state.
    private var entering: Bool { editing || state?.hasKey_p == false }

    var body: some View {
        Section {
            if let state {
                if entering, !state.environmentManaged {
                    SecureField("API key", text: $key)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } else {
                    LabeledContent("API key") {
                        HStack(spacing: 8) {
                            StatusDot(color: Palette.positive)
                            Text(state.environmentManaged ? "••••••••" : "Configured")
                        }
                    }
                }
            } else {
                ProgressView()
            }
        } header: {
            Text(title)
        } footer: {
            if state?.environmentManaged == true { Text("Managed by the environment.") }
        }
        .task { await load() }
        if let state, !state.environmentManaged {
            FormActions {
                if entering {
                    if state.hasKey_p {
                        Button("Cancel") { editing = false; key = "" }
                    }
                    Button("Save") { Task { await set(key) } }
                        .buttonStyle(FormActionStyle(prominent: true))
                        .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
                } else {
                    Button("Remove", role: .destructive) { confirmingRemove = true }
                        .confirmationDialog("Remove this key?", isPresented: $confirmingRemove, titleVisibility: .visible) {
                            Button("Remove", role: .destructive) { Task { await set("") } }
                        }
                    Button("Update") { editing = true }
                }
            }
        }
    }

    private func load() async {
        var request = Euler_V1_GetApiKeyRequest()
        request.provider = provider
        state = try? await session.backend.providers.getApiKey(request: request, headers: [:]).value().state
    }

    private func set(_ value: String) async {
        var request = Euler_V1_SetApiKeyRequest()
        request.provider = provider
        request.apiKey = value.trimmingCharacters(in: .whitespaces)
        let ok = await session.notices.attempt {
            state = try await session.backend.providers.setApiKey(request: request, headers: [:]).value().state
        }
        if ok {
            editing = false
            key = ""
            await onChange()
        }
    }
}

/// Image Generation: OpenRouter or Vercel AI Gateway provider and default model.
struct ImageGenerationSettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var models: [Euler_V1_ImageModel] = []

    private var saved: Euler_V1_ImagePreferences { session.preferences.preferences.image }

    var body: some View {
        ThemedForm {
            Section {
                Picker("Provider", selection: Binding(
                    get: { saved.provider },
                    set: { next in
                        savePreferences(session) {
                            $0.image.provider = next
                            if next != saved.provider { $0.image.model = "" }
                        }
                        Task { await loadModels(provider: next) }
                    }
                ).ticking()) {
                    Text("Auto").tag(Euler_V1_ImageProvider.unspecified)
                    Text("OpenRouter").tag(Euler_V1_ImageProvider.openrouter)
                    Text("Vercel AI Gateway").tag(Euler_V1_ImageProvider.vercelGateway)
                }
                .mutedPickerValue()

                Picker("Model", selection: Binding(
                    get: { saved.model },
                    set: { next in savePreferences(session) { $0.image.model = next } }
                ).ticking()) {
                    Text("Auto").tag("")
                    if !saved.model.isEmpty, !models.contains(where: { $0.id == saved.model }) {
                        Text(saved.model).tag(saved.model)
                    }
                    ForEach(models, id: \.id) { model in
                        Text(model.name).tag(model.id)
                    }
                }
                .mutedPickerValue()
            } header: {
                Text("Defaults")
            } footer: {
                Text("Uses the API keys configured in OpenRouter and Vercel AI Gateway settings.")
            }
        }
        .navigationTitle("Image Generation")
        .task { await loadModels(provider: saved.provider) }
    }

    private func loadModels(provider: Euler_V1_ImageProvider) async {
        var request = Euler_V1_ListImageModelsRequest()
        request.provider = provider
        let loaded = (try? await session.backend.providers.listImageModels(request: request, headers: [:]).value().models) ?? []
        var seen = Set<String>()
        models = loaded.filter { seen.insert($0.id).inserted }
    }
}

/// Web Search: the Brave Search API key.
struct WebSearchSettingsView: View {
    var body: some View {
        ThemedForm {
            ApiKeySection(provider: .brave, title: "Brave Search")
        }
        .navigationTitle("Web Search")
    }
}
