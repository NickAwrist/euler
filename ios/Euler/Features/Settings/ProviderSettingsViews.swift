import EulerAPI
import SwiftUI

/// Ollama: the server's address, a connection test, and its state.
struct OllamaSettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var host = ""
    @State private var config: Euler_V1_HostConfig?
    @State private var health: Euler_V1_GetOllamaHealthResponse?

    var body: some View {
        let managed = session.preferences.environment.ollamaHost
        ThemedForm {
            HostSection(
                title: "Server URL",
                placeholder: "http://127.0.0.1:11434",
                host: $host,
                saved: config?.host ?? "",
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
        }
        .navigationTitle("Ollama")
        .task {
            if let response = try? await session.backend.providers.getOllamaConfig(request: .init(), headers: [:]).value() {
                config = response.config
                host = response.config.host.isEmpty ? response.config.effectiveHost : response.config.host
            }
            await loadHealth()
        }
    }

    private func loadHealth() async {
        health = try? await session.backend.providers.getOllamaHealth(request: .init(), headers: [:]).value()
    }
}

/// An address field with Test and Save, read-only when the environment sets it.
struct HostSection: View {
    let title: String
    let placeholder: String
    @Binding var host: String
    let saved: String
    let managed: Bool
    let connected: Bool?
    let test: (String) async throws -> Euler_V1_HostTest
    let save: (String) async throws -> Void
    @Environment(AppSession.self) private var session
    @State private var result: String?
    @State private var resultOK = false
    @State private var testing = false
    /// The address a result belongs to; editing it hides a stale result.
    @State private var testedHost = ""

    var body: some View {
        Section {
            TextField(placeholder, text: $host)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .disabled(managed)
                .accessibilityLabel(title)
            if let connected {
                LabeledContent("Status", value: connected ? "Connected" : "Not connected")
            }
            Button("Test connection") { Task { await runTest() } }
                .disabled(testing || host.trimmingCharacters(in: .whitespaces).isEmpty)
            if let result, testedHost == host {
                Text(result).font(.footnote).foregroundStyle(resultOK ? .green : .red)
            }
            if !managed, host != saved {
                Button("Save settings") {
                    Task {
                        if await session.notices.attempt({ try await save(host.trimmingCharacters(in: .whitespaces)) }) {
                            session.notices.success("Saved.")
                        }
                    }
                }
            }
        } header: {
            Text(title)
        } footer: {
            if managed { Text("Managed by the environment.") }
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

/// An API key the server stores: Update, Remove, or read-only from the environment.
struct ApiKeySection: View {
    let provider: Euler_V1_ApiKeyProvider
    let title: String
    var onChange: () async -> Void = {}
    @Environment(AppSession.self) private var session
    @State private var state: Euler_V1_ApiKeyState?
    @State private var editing = false
    @State private var key = ""

    var body: some View {
        Section {
            if let state {
                if state.environmentManaged {
                    LabeledContent("API key", value: "••••••••")
                } else if editing || !state.hasKey_p {
                    SecureField("API key", text: $key)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Save key") { Task { await set(key) } }
                        .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
                    if state.hasKey_p {
                        Button("Cancel") { editing = false; key = "" }
                        Button("Remove key", role: .destructive) { Task { await set("") } }
                    }
                } else {
                    LabeledContent("API key", value: "Configured")
                    Button("Update key") { editing = true }
                }
            } else {
                ProgressView()
            }
        } header: {
            Text(title)
        } footer: {
            if state?.environmentManaged == true { Text("Managed by the environment.") }
            else if state?.hasKey_p == false { Text("Not configured") }
        }
        .task { await load() }
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

/// Image Generation: the ComfyUI server, its default model and image settings.
struct ImageGenerationSettingsView: View {
    @Environment(AppSession.self) private var session
    @State private var host = ""
    @State private var config: Euler_V1_HostConfig?
    @State private var image = Euler_V1_ImagePreferences()
    @State private var savedImage = Euler_V1_ImagePreferences()
    @State private var models: [String] = []
    @State private var health: Euler_V1_GetComfyUiHealthResponse?

    var body: some View {
        let managed = session.preferences.environment.comfyuiHost
        ThemedForm {
            HostSection(
                title: "ComfyUI URL",
                placeholder: "http://127.0.0.1:8188",
                host: $host,
                saved: config?.host ?? "",
                managed: managed,
                connected: health?.connected,
                test: { host in
                    var request = Euler_V1_TestComfyUiHostRequest()
                    request.host = host
                    return try await session.backend.providers.testComfyUiHost(request: request, headers: [:]).value().result
                },
                save: { host in
                    var request = Euler_V1_UpdateComfyUiConfigRequest()
                    request.host = host
                    config = try await session.backend.providers.updateComfyUiConfig(request: request, headers: [:]).value().config
                    await load()
                }
            )
            Section("Defaults") {
                Picker("Model", selection: $image.defaultModel) {
                    Text("None").tag("")
                    ForEach(models, id: \.self) { Text($0).tag($0) }
                    if !image.defaultModel.isEmpty, !models.contains(image.defaultModel) {
                        Text(image.defaultModel).tag(image.defaultModel)
                    }
                }
                Stepper("Width \(image.defaultWidth)", value: $image.defaultWidth, in: 64...16384, step: 64)
                Stepper("Height \(image.defaultHeight)", value: $image.defaultHeight, in: 64...16384, step: 64)
                TextField("Negative prompt", text: $image.negativePrompt, axis: .vertical)
                    .lineLimit(2...6)
                    .accessibilityLabel("Negative prompt")
                if image != savedImage {
                    Button("Save settings") { Task { await saveImage() } }
                }
            }
        }
        .navigationTitle("Image Generation")
        .task { await load() }
    }

    private func load() async {
        let providers = session.backend.providers
        if let response = try? await providers.getComfyUiConfig(request: .init(), headers: [:]).value() {
            config = response.config
            host = response.config.host.isEmpty ? response.config.effectiveHost : response.config.host
            image = response.image
            savedImage = response.image
        }
        health = try? await providers.getComfyUiHealth(request: .init(), headers: [:]).value()
        models = (try? await providers.listComfyUiModels(request: .init(), headers: [:]).value().models) ?? []
    }

    private func saveImage() async {
        var request = Euler_V1_UpdateComfyUiConfigRequest()
        request.image.defaultModel = image.defaultModel
        request.image.defaultWidth = image.defaultWidth
        request.image.defaultHeight = image.defaultHeight
        request.image.negativePrompt = image.negativePrompt
        let ok = await session.notices.attempt {
            let response = try await session.backend.providers.updateComfyUiConfig(request: request, headers: [:]).value()
            image = response.image
            savedImage = response.image
        }
        if ok { session.notices.success("Saved.") }
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
