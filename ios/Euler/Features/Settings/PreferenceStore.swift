import EulerAPI
import Foundation
import Observation

/// The user's saved preferences, shared with the web, and which server
/// settings the environment controls.
@Observable
final class PreferenceStore {
    private(set) var preferences = Euler_V1_UserPreferences()
    private(set) var environment = Euler_V1_GetEnvironmentResponse()
    private(set) var loaded = false
    private(set) var error: String?

    @ObservationIgnored let client: any Euler_V1_PreferenceServiceClientInterface

    init(client: any Euler_V1_PreferenceServiceClientInterface) {
        self.client = client
    }

    var settings: Euler_V1_UserSettings { preferences.settings }
    var appearance: Euler_V1_Appearance { preferences.appearance }

    func load() async {
        do {
            async let saved = client.getPreferences(request: .init(), headers: [:]).value()
            async let ownership = client.getEnvironment(request: .init(), headers: [:]).value()
            preferences = try await saved.preferences
            environment = try await ownership
            error = nil
        } catch {
            self.error = error.displayMessage
        }
        loaded = true
    }

    /// Saves a patch and adopts the complete preferences the server returns.
    func update(_ build: (inout Euler_V1_UpdatePreferencesRequest) -> Void) async throws {
        var request = Euler_V1_UpdatePreferencesRequest()
        build(&request)
        preferences = try await client.updatePreferences(request: request, headers: [:]).value().preferences
    }

    /// Adopts preferences another call saved and returned, such as a permission rule change.
    func adopt(_ preferences: Euler_V1_UserPreferences) {
        self.preferences = preferences
    }

    /// The personalization sent with each turn, as the web builds it.
    var runMetadata: Euler_V1_RunMetadata {
        var metadata = Euler_V1_RunMetadata()
        let settings = preferences.settings
        func trimmed(_ value: String) -> String? {
            let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? nil : text
        }
        if settings.hasSystemPrompt, let prompt = trimmed(settings.systemPrompt) { metadata.systemPrompt = prompt }
        if let name = trimmed(settings.name) { metadata.name = name }
        if let location = trimmed(settings.location) { metadata.location = location }
        if let formats = trimmed(settings.preferredFormats) { metadata.preferredFormats = formats }
        metadata.includeCurrentDate = settings.includeCurrentDate
        return metadata
    }
}
