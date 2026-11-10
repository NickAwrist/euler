import EulerAPI
import SwiftUI

/// The pages Settings can open on.
enum SettingsPage: Hashable, Identifiable {
    case root, general, appearance, ollama, openRouter, chatGpt, imageGeneration, webSearch
    case customization, personalization, skills, tools, usage

    var id: Self { self }
}

extension EnvironmentValues {
    /// Opens a Settings page: pushed inside Settings, presented anywhere else.
    @Entry var openSettings: (SettingsPage) -> Void = { _ in }
}

/// Settings, Customization and Usage, page for page with the web.
struct SettingsView: View {
    /// The page the sheet opens on. It is the bottom of the stack, so leaving it
    /// returns to wherever it was opened from rather than to the list of pages.
    var page = SettingsPage.root
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var path: [SettingsPage] = []

    var body: some View {
        NavigationStack(path: $path) {
            destination(page)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { done }
                .navigationDestination(for: SettingsPage.self) { page in
                    destination(page)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar { done }
                }
        }
        .environment(\.openSettings) { page in path.append(page) }
        .presentationBackground(palette.background)
        .task { await session.preferences.load() }
    }

    private var pages: some View {
        ThemedList {
            Section {
                row(.general, "General", .system("gearshape.fill", Color(hex: 0x8E8E93)))
                row(.appearance, "Appearance", .system("paintpalette.fill", Color(hex: 0x5E5CE6)))
            }
            Section {
                row(.ollama, "Ollama", .provider(.ollama))
                row(.openRouter, "OpenRouter", .provider(.openrouter))
                row(.chatGpt, "ChatGPT", .provider(.codex))
                row(.imageGeneration, "Image Generation", .system("photo.fill", Color(hex: 0xFF375F)))
                row(.webSearch, "Web Search", .system("globe", Color(hex: 0x0A84FF)))
            }
            Section("Customization") { customizationRows }
            Section {
                row(.usage, "Usage insights", .system("chart.bar.fill", Color(hex: 0xBF5AF2)))
            }
        }
        .navigationTitle("Settings")
    }

    @ViewBuilder
    private var customizationRows: some View {
        row(.personalization, "Personalization", .system("person.fill", Color(hex: 0xFF9F0A)))
        row(.skills, "Skills", .system("book.fill", Color(hex: 0x30D158)))
        row(.tools, "Tools", .system("wrench.and.screwdriver.fill", Color(hex: 0x40A6C8)))
    }

    private var done: some ToolbarContent {
        CloseToolbarItem { dismiss() }
    }

    private enum RowIcon {
        /// A white glyph on its own color, as iOS Settings marks its pages.
        case system(String, Color)
        case provider(ProviderIconAsset)
    }

    private func row(_ page: SettingsPage, _ title: String, _ icon: RowIcon) -> some View {
        NavigationLink(value: page) {
            HStack(spacing: 12) {
                switch icon {
                case .system(let name, let color):
                    Image(systemName: name)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(color.gradient, in: .rect(cornerRadius: 8))
                case .provider(let asset):
                    ProviderIcon(icon: asset, size: 16)
                        .frame(width: 30, height: 30)
                        .background(palette.fill, in: .rect(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(palette.borderSubtle))
                }
                Text(title).foregroundStyle(palette.foreground)
            }
        }
    }

    @ViewBuilder
    private func destination(_ page: SettingsPage) -> some View {
        switch page {
        case .root: pages
        case .customization: ThemedList { customizationRows }.navigationTitle("Customization")
        case .general: GeneralSettingsView()
        case .appearance: AppearanceSettingsView()
        case .ollama: OllamaSettingsView()
        case .openRouter: OpenRouterSettingsView()
        case .chatGpt: ChatGptSettingsView()
        case .imageGeneration: ImageGenerationSettingsView()
        case .webSearch: WebSearchSettingsView()
        case .personalization: PersonalizationView()
        case .skills: SkillsView()
        case .tools: ToolsSettingsView()
        case .usage: UsageView()
        }
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
    @State private var choosingDefault = false
    @Environment(\.palette) private var palette

    var body: some View {
        ThemedForm {
            Section("Connection") {
                LabeledContent("Server", value: session.backend.baseURL.absoluteString)
                LabeledContent("Status") {
                    switch session.events.status {
                    case .connected: Label("Connected", systemImage: "circle.fill").foregroundStyle(Palette.positive).imageScale(.small)
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
                Button { editingIdentity = true } label: {
                    LabeledContent("Change server or user") { RowChevron() }
                }
            }
            Section("Chat Defaults") {
                let saved = session.preferences.settings.defaultModel
                let model = session.models.model(saved)
                let name = model?.name ?? (saved.isEmpty ? "None" : "\(Euler_V1_Model.displayRoute(saved)) (unavailable)")
                Button { choosingDefault = true } label: {
                    HStack(spacing: 6) {
                        Text("Default model").foregroundStyle(palette.foreground).fixedSize()
                        Spacer(minLength: 8)
                        if let model {
                            ProviderIcon(icon: .forModel(model), name: model.lab, size: 16)
                        } else if !saved.isEmpty {
                            ProviderIcon(icon: .forModelID(saved), size: 16)
                        }
                        Text(name).lineLimit(1).foregroundStyle(palette.muted)
                        Image(systemName: "chevron.up.chevron.down").font(.caption2).foregroundStyle(palette.muted)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel("Default model")
                .accessibilityValue(name)
                .accessibilityAddTraits(.isButton)
            }
            Section("Notifications") {
                Toggle("Turn results and approvals", isOn: Binding(
                    get: { push.isEnabled && push.authorization != .denied },
                    set: { enabled in Task { await push.setEnabled(enabled, backend: session.backend) } }
                ))
                .disabled(push.authorization == .denied)
                if push.authorization == .denied {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    } label: {
                        LabeledContent("Allow in iOS Settings") { RowChevron(systemName: "arrow.up.right") }
                    }
                }
            }
            Section {
                Button("Sign out", role: .destructive) { confirmingSignOut = true }
            }
        }
        .navigationTitle("General")
        .sheet(isPresented: $choosingDefault) {
            ModelPickerSheet(selected: session.preferences.settings.defaultModel) { picked in
                savePreferences(session) { $0.settings.defaultModel = picked.id }
            }
        }
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
