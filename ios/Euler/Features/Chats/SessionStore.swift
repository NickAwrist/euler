import EulerAPI
import Foundation
import Observation

/// The user's chats, newest first, as the chat list shows them.
@Observable
final class SessionStore {
    private(set) var sessions: [Euler_V1_SessionSummary] = []
    private(set) var loaded = false
    private(set) var error: String?

    @ObservationIgnored private let client: any Euler_V1_SessionServiceClientInterface
    @ObservationIgnored private var loading: Task<Void, Never>?

    init(client: any Euler_V1_SessionServiceClientInterface) {
        self.client = client
    }

    /// Reloads the list; overlapping calls share one request.
    func reload() async {
        if let loading { return await loading.value }
        let task = Task {
            do {
                sessions = try await client.listSessions(request: .init(), headers: [:]).value().sessions
                error = nil
            } catch {
                self.error = error.displayMessage
            }
            loaded = true
        }
        loading = task
        await task.value
        loading = nil
    }

    func summary(_ id: String) -> Euler_V1_SessionSummary? {
        sessions.first { $0.id == id }
    }

    /// Starts a chat with `model`; an ephemeral one is deleted after its lifetime.
    func create(model: String?, ephemeral: Bool) async throws -> Euler_V1_CreateSessionResponse {
        var request = Euler_V1_CreateSessionRequest()
        if let model, !model.isEmpty { request.model = model }
        request.ephemeral = ephemeral
        let created = try await client.createSession(request: request, headers: [:]).value()
        await reload()
        return created
    }

    /// Renames a chat; an empty title goes back to the first message.
    func rename(_ id: String, to title: String) async throws {
        var request = Euler_V1_UpdateSessionRequest()
        request.id = id
        request.customTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        _ = try await client.updateSession(request: request, headers: [:]).value()
        if let index = sessions.firstIndex(where: { $0.id == id }) {
            if request.customTitle.isEmpty {
                sessions[index].clearCustomTitle()
            } else {
                sessions[index].customTitle = request.customTitle
            }
        }
        await reload()
    }

    func delete(_ id: String) async throws {
        var request = Euler_V1_DeleteSessionRequest()
        request.id = id
        _ = try await client.deleteSession(request: request, headers: [:]).value()
        sessions.removeAll { $0.id == id }
    }

    /// Clears a chat's unread badge.
    func markViewed(_ id: String) async {
        var request = Euler_V1_MarkViewedRequest()
        request.id = id
        guard (try? await client.markViewed(request: request, headers: [:]).value()) != nil else { return }
        if let index = sessions.firstIndex(where: { $0.id == id }), sessions[index].badge == .unread {
            sessions[index].badge = .unspecified
        }
    }
}

extension Euler_V1_SessionSummary {
    /// The name the list shows: the custom title, else the first message's preview.
    var title: String {
        hasCustomTitle && !customTitle.isEmpty ? customTitle : preview
    }
}

extension Euler_V1_SessionSummary: @retroactive Identifiable {}
