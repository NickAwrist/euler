import EulerAPI
import Foundation
import Observation

/// Everything that belongs to one signed-in identity: the backend client, the
/// event stream, and the stores the stream feeds.
@Observable
final class AppSession {
    let backend: Backend
    let events: EventStream
    let sessions: SessionStore
    let models: ModelStore
    let preferences: PreferenceStore
    let completions: CompletionSources
    let notices = Notices()
    /// The chat a tapped notification or the chat list asks to show.
    var route: Route?

    /// Chats with a store, so going back and forth keeps their state.
    @ObservationIgnored private var chats: [String: ChatStore] = [:]
    /// Recent events, replayed onto a runtime fetched while they arrived.
    @ObservationIgnored private var recent: [Euler_V1_Event] = []
    private static let recentLimit = 2000

    enum Route: Hashable {
        case chat(String)
        case newChat
    }

    init(identity: Identity) {
        backend = Backend(baseURL: identity.serverURL, userID: identity.userID)
        events = EventStream(client: backend.events)
        sessions = SessionStore(client: backend.sessions)
        models = ModelStore(client: backend.models, userID: identity.userID)
        preferences = PreferenceStore(client: backend.preferences)
        completions = CompletionSources(backend: backend)
        SharedSettings.setServerURL(identity.serverURL)
        events.onEvent = { [weak self] event in self?.apply(event) }
    }

    /// The store for a chat, made on first use.
    func chat(_ id: String) -> ChatStore {
        if let existing = chats[id] { return existing }
        let store = ChatStore(id: id, backend: backend, session: self)
        chats[id] = store
        return store
    }

    /// Events after `sequence` for a chat, to replay onto a runtime snapshot.
    func recentEvents(for sessionID: String, after sequence: UInt64) -> [Euler_V1_Event] {
        recent.filter { $0.sessionID == sessionID && $0.sequence > sequence }
    }

    /// Forgets a deleted chat's store.
    func forget(_ id: String) {
        chats[id] = nil
    }

    private func apply(_ event: Euler_V1_Event) {
        if case .resync = event.payload {
            recent.removeAll()
            for chat in chats.values { Task { await chat.refresh() } }
            Task { await sessions.reload() }
            return
        }
        recent.append(event)
        if recent.count > Self.recentLimit { recent.removeFirst(recent.count - Self.recentLimit) }
        let chat = chats[event.sessionID]
        let before = chat?.agent(event.agentID)
        chat?.apply(event)
        // The chat list shows only whether a chat has working agents.
        switch event.payload {
        case .activationEnded:
            Task { await sessions.reload() }
        case .agentStatus(let change) where before?.isWorking != change.agent.isWorking:
            Task { await sessions.reload() }
        case .transcriptAppended where chat == nil:
            Task { await sessions.reload() }
        default:
            break
        }
    }
}

/// One transient message at a time, shown over the current screen. Its tone
/// sets the haptic, so callers never add their own for a notice.
@Observable
final class Notices {
    enum Tone { case info, success, failure }

    struct Notice: Equatable {
        let message: String
        let tone: Tone
    }

    private(set) var current: Notice?
    @ObservationIgnored private var dismissal: Task<Void, Never>?

    func info(_ message: String) { show(Notice(message: message, tone: .info)) }
    func success(_ message: String) { show(Notice(message: message, tone: .success)) }
    func failure(_ message: String) { show(Notice(message: message, tone: .failure)) }
    func failure(_ error: any Error) { failure(error.displayMessage) }

    /// Runs `work`, reporting a thrown error as a failure. Returns whether it succeeded.
    @discardableResult
    func attempt(_ work: () async throws -> Void) async -> Bool {
        do {
            try await work()
            return true
        } catch is CancellationError {
            return false
        } catch {
            failure(error)
            return false
        }
    }

    func dismiss() {
        current = nil
    }

    private func show(_ notice: Notice) {
        current = notice
        switch notice.tone {
        case .info: break
        case .success: Haptics.success()
        case .failure: Haptics.failure()
        }
        dismissal?.cancel()
        dismissal = Task {
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { self.current = nil }
        }
    }
}
