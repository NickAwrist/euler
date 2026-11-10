import EulerAPI
import SwiftUI

/// The system prompt and the personal details sent with each turn. Edits stay
/// a draft until Save, like the web's Customization page.
struct PersonalizationView: View {
    @Environment(AppSession.self) private var session
    @State private var draft = Euler_V1_UserSettings()
    @State private var loaded = false
    @State private var saving = false

    private var saved: Euler_V1_UserSettings { session.preferences.settings }
    private var changed: Bool { loaded && draft != saved }

    var body: some View {
        ThemedForm {
            Section {
                TextEditor(text: Binding(
                    get: { draft.hasSystemPrompt ? draft.systemPrompt : "" },
                    set: { draft.systemPrompt = $0 }
                ))
                .font(.footnote.monospaced())
                .frame(minHeight: 220)
                .accessibilityLabel("System Prompt")
                Button("Reset to default", systemImage: "arrow.counterclockwise") { draft.clearSystemPrompt() }
                    .disabled(!draft.hasSystemPrompt || draft.systemPrompt.isEmpty)
            } header: {
                Text("System Prompt")
            } footer: {
                Text("Empty uses the default prompt.")
            }
            Section("About you") {
                TextField("Enter your name", text: $draft.name)
                    .textContentType(.name)
                TextField("Location", text: $draft.location)
                TextField("Preferred formats", text: $draft.preferredFormats, axis: .vertical)
                Toggle("Include current date", isOn: $draft.includeCurrentDate)
            }
        }
        .navigationTitle("Personalization")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Save") { Task { await save() } }
                    .disabled(!changed || saving)
            }
        }
        .onAppear {
            guard !loaded else { return }
            draft = saved
            loaded = true
        }
        .interactiveDismissDisabled(changed)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let draft = draft
        let ok = await session.notices.attempt {
            try await session.preferences.update { request in
                // An empty prompt restores the default.
                request.settings.systemPrompt = draft.hasSystemPrompt ? draft.systemPrompt : ""
                request.settings.name = draft.name
                request.settings.location = draft.location
                request.settings.preferredFormats = draft.preferredFormats
                request.settings.includeCurrentDate = draft.includeCurrentDate
            }
        }
        if ok {
            self.draft = saved
            session.notices.success("Saved.")
        }
    }
}
