import EulerAPI
import SwiftUI

/// Settings, Customization and Usage, page for page with the web.
struct SettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Settings") {
                    NavigationLink { GeneralSettingsView() } label: { Label("General", systemImage: "gearshape") }
                    NavigationLink { AppearanceSettingsView() } label: { Label("Appearance", systemImage: "paintpalette") }
                    NavigationLink { OllamaSettingsView() } label: { Label("Ollama", systemImage: "desktopcomputer") }
                    NavigationLink { OpenRouterSettingsView() } label: { Label("OpenRouter", systemImage: "point.3.filled.connected.trianglepath.dotted") }
                    NavigationLink { ChatGptSettingsView() } label: { Label("ChatGPT", systemImage: "bubble.left.and.text.bubble.right") }
                    NavigationLink { ImageGenerationSettingsView() } label: { Label("Image Generation", systemImage: "photo.artframe") }
                    NavigationLink { WebSearchSettingsView() } label: { Label("Web Search", systemImage: "magnifyingglass") }
                }
                Section("Customization") {
                    NavigationLink { PersonalizationView() } label: { Label("Personalization", systemImage: "person.text.rectangle") }
                    NavigationLink { SkillsView() } label: { Label("Skills", systemImage: "book") }
                    NavigationLink { ToolsSettingsView() } label: { Label("Tools", systemImage: "wrench.and.screwdriver") }
                }
                Section {
                    NavigationLink { UsageView() } label: { Label("Usage insights", systemImage: "chart.bar.xaxis") }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .task { await session.preferences.load() }
    }
}

/// Saves one change to the shared preferences, reporting failures as a notice.
@MainActor
func savePreferences(_ session: AppSession, _ build: @escaping (inout Euler_V1_UpdatePreferencesRequest) -> Void) {
    Task {
        await session.notices.attempt { try await session.preferences.update(build) }
    }
}

struct GeneralSettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(IdentityStore.self) private var identityStore
    @Environment(PushNotifications.self) private var push
    @State private var editingIdentity = false
    @State private var confirmingSignOut = false

    var body: some View {
        Form {
            Section("Connection") {
                LabeledContent("Server", value: session.backend.baseURL.absoluteString)
                LabeledContent("Status") {
                    switch session.events.status {
                    case .connected: Label("Connected", systemImage: "circle.fill").foregroundStyle(.green)
                    case .connecting: Text("Connecting")
                    case .disconnected: Label("Reconnecting", systemImage: "circle").foregroundStyle(.orange)
                    }
                }
                .labelStyle(.titleAndIcon)
                VStack(alignment: .leading, spacing: 4) {
                    Text("User ID")
                    Text(session.backend.userID)
                        .font(.footnote.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                Button("Change server or user") { editingIdentity = true }
            }
            Section("Chat Defaults") {
                Picker("Default model", selection: Binding(
                    get: { session.preferences.settings.defaultModel },
                    set: { model in savePreferences(session) { $0.settings.defaultModel = model } }
                )) {
                    if session.models.selectable.isEmpty { Text("No models found").tag(session.preferences.settings.defaultModel) }
                    ForEach(session.models.selectable, id: \.id) { model in
                        Text(model.name).tag(model.id)
                    }
                }
                .pickerStyle(.navigationLink)
            }
            Section("Notifications") {
                Toggle("Turn results and approvals", isOn: Binding(
                    get: { push.isEnabled && push.authorization != .denied },
                    set: { enabled in Task { await push.setEnabled(enabled, backend: session.backend) } }
                ))
                .disabled(push.authorization == .denied)
                if push.authorization == .denied {
                    Button("Allow in iOS Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    }
                }
            }
            Section {
                Button("Sign out", role: .destructive) { confirmingSignOut = true }
            }
        }
        .navigationTitle("General")
        .task { await push.refreshAuthorization() }
        .sheet(isPresented: $editingIdentity) { IdentityEditor() }
        .confirmationDialog("Sign out of this user?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) {
                Task {
                    await push.setEnabled(false, backend: session.backend)
                    identityStore.signOut()
                }
            }
        }
    }
}
