import EulerAPI
import Foundation
import Observation

/// The server's features: the switches in Settings, and what a chat draws from them.
@Observable
final class FeatureStore {
    private(set) var features: [Euler_V1_Feature] = []
    private(set) var loaded = false

    @ObservationIgnored private let client: any Euler_V1_FeatureServiceClientInterface

    init(client: any Euler_V1_FeatureServiceClientInterface) {
        self.client = client
    }

    var chat: ChatFeatures { ChatFeatures(features) }

    /// A failed load keeps what was loaded before.
    func load() async {
        if let response = try? await client.listFeatures(request: .init(), headers: [:]).value() {
            features = response.features
        }
        loaded = true
    }

    /// Shown at once, as on the web, and put back if the server refuses.
    func setEnabled(_ id: Euler_V1_FeatureId, _ enabled: Bool) async throws {
        var request = Euler_V1_SetFeatureEnabledRequest()
        request.id = id
        request.enabled = enabled
        let previous = features
        if let index = features.firstIndex(where: { $0.id == id }) { features[index].enabled = enabled }
        do {
            features = try await client.setFeatureEnabled(request: request, headers: [:]).value().features
        } catch {
            features = previous
            throw error
        }
    }
}
