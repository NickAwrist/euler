import EulerAPI
import Foundation
import Observation

/// One chat: its stored session and its live runtime, kept current by the
/// event stream. Views read only the parts they show, so a streamed token
/// redraws the reply in progress and nothing else.
@Observable
final class ChatStore {
    let id: String
    private(set) var session: Euler_V1_Session?
    private(set) var history: [Euler_V1_Message] = []
    private(set) var agents: [Euler_V1_Agent] = []
    private(set) var jobs: [Euler_V1_Job] = []
    private(set) var queued: [Euler_V1_InboxMessage] = []
    private(set) var held = false
    private(set) var approvals: [Euler_V1_ToolApproval] = []
    private(set) var phases: [String: AgentPhase] = [:]
    /// Whether the main agent has a turn in progress.
    private(set) var running = false
    private(set) var loaded = false
    private(set) var loadError: String?
    let live = LiveReply()
    let draft = ComposerDraft()
    /// Whether the chat is on screen, so a finished turn marks it read.
    @ObservationIgnored var isVisible = false

    @ObservationIgnored private var state = RuntimeState()
    @ObservationIgnored private let backend: Backend
    @ObservationIgnored private weak var app: AppSession?

    init(id: String, backend: Backend, session app: AppSession?) {
        self.id = id
        self.backend = backend
        self.app = app
    }

    var mainAgent: Euler_V1_Agent? { state.mainAgent }
    var subagents: [Euler_V1_Agent] {
        agents.filter { $0.kind != .main }.sorted { $0.spawnPosition < $1.spawnPosition }
    }

    func agent(_ id: String) -> Euler_V1_Agent? {
        agents.first { $0.id == id }
    }

    /// Loads the stored chat and its runtime.
    func load() async {
        var request = Euler_V1_GetSessionRequest()
        request.id = id
        do {
            session = try await backend.sessions.getSession(request: request, headers: [:]).value().session
            try await fetchRuntime()
            loadError = nil
        } catch {
            if !loaded { loadError = error.displayMessage }
        }
        loaded = true
    }

    /// Refetches the runtime, as after a Resync or returning to the foreground.
    func refresh() async {
        try? await fetchRuntime()
    }

    private func fetchRuntime() async throws {
        var request = Euler_V1_GetRuntimeRequest()
        request.sessionID = id
        let snapshot = try await backend.agent.getRuntime(request: request, headers: [:]).value()
        var next = RuntimeState(snapshot: snapshot)
        // Events that arrived while the snapshot was on its way.
        for event in app?.recentEvents(for: id, after: next.sequence) ?? [] { next.apply(event) }
        // A slower response must not undo newer events already applied.
        guard next.sequence >= state.sequence || !loaded else { return }
        state = next
        publish(.all)
    }

    func apply(_ event: Euler_V1_Event) {
        let wasRunning = state.activation != nil
        let changes = state.apply(event)
        switch AgentPhase.next(after: event) {
        case .keep: break
        case .set(let phase): if phases[event.agentID] != phase { phases[event.agentID] = phase }
        case .end: if phases[event.agentID] != nil { phases[event.agentID] = nil }
        }
        publish(changes)
        if case .approvalRequested = event.payload, changes.contains(.approvals) {
            Haptics.warning()
        }
        if wasRunning, state.activation == nil, isVisible {
            Haptics.success()
            Task { await app?.sessions.markViewed(id) }
        }
    }

    private func publish(_ changes: RuntimeState.Changes) {
        if changes.contains(.history) { history = state.history }
        if changes.contains(.agents) { agents = state.agents }
        if changes.contains(.queued) { queued = state.queued }
        if changes.contains(.held) { held = state.held }
        if changes.contains(.approvals) { approvals = state.approvals }
        if changes.contains(.jobs) { jobs = state.jobs }
        if changes.contains(.activation) || changes.contains(.liveText) {
            live.show(state.activation, coalesce: !changes.contains(.activation))
            if running != (state.activation != nil) { running = state.activation != nil }
        }
    }

    // MARK: Turns

    private func settings(model: String?, effort: String?) -> Euler_V1_TurnSettings {
        var settings = Euler_V1_TurnSettings()
        if let model, !model.isEmpty { settings.model = model }
        if let effort { settings.reasoningEffort = effort }
        if let metadata = app?.preferences.runMetadata { settings.metadata = metadata }
        return settings
    }

    /// Sends a message, queued behind the current turn when one is running.
    func send(_ content: String, attachments: [String], model: String?, effort: String?) async throws {
        var request = Euler_V1_SendMessageRequest()
        request.sessionID = id
        request.content = content
        request.attachmentIds = attachments
        request.settings = settings(model: model, effort: effort)
        _ = try await backend.agent.sendMessage(request: request, headers: [:]).value()
        await refresh()
    }

    /// Reruns from the user message at `position`, with new text or kept versions of its reply.
    func rewind(to position: Int, content: String?, versions: [Euler_V1_MessageVersion], model: String?, effort: String?) async throws {
        var request = Euler_V1_RewindRequest()
        request.sessionID = id
        request.position = Int32(position)
        if let content { request.content = content }
        request.versions = versions
        request.settings = settings(model: model, effort: effort)
        _ = try await backend.agent.rewind(request: request, headers: [:]).value()
        await refresh()
    }

    /// Reruns the user message before the reply at `index`, keeping the reply as a version.
    func regenerate(at index: Int, model: String?, effort: String?) async throws {
        guard history.indices.contains(index), history[index].role == .assistant,
              let userIndex = history[..<index].lastIndex(where: { $0.role == .user })
        else { return }
        let reply = history[index]
        var kept = Euler_V1_MessageVersion()
        kept.content = reply.content
        kept.steps = reply.steps
        kept.attachments = reply.attachments
        try await rewind(to: userIndex, content: history[userIndex].content, versions: reply.versions + [kept], model: model, effort: effort)
    }

    /// Whether rerunning from `index` drops later messages or subagents, which the user confirms first.
    func rerunDiscards(from index: Int) -> Bool {
        index < history.count - 1 || subagents.contains { $0.spawnPosition >= index }
    }

    func stop() async throws {
        var request = Euler_V1_StopRequest()
        request.sessionID = id
        _ = try await backend.agent.stop(request: request, headers: [:]).value()
        Haptics.firm()
        await refresh()
    }

    /// Sends held or queued messages to the agent now.
    func deliver() async throws {
        var request = Euler_V1_DeliverRequest()
        request.sessionID = id
        _ = try await backend.agent.deliver(request: request, headers: [:]).value()
        await refresh()
    }

    func removeQueued(_ message: Euler_V1_InboxMessage) async throws {
        var request = Euler_V1_RemoveQueuedRequest()
        request.sessionID = id
        request.messageID = message.id
        _ = try await backend.agent.removeQueued(request: request, headers: [:]).value()
        await refresh()
    }

    /// Answers an approval; allowing matching calls returns the rule it saved.
    @discardableResult
    func respond(to approval: Euler_V1_ToolApproval, _ decision: Euler_V1_ApprovalDecision) async throws -> Euler_V1_ToolPermissionRule? {
        var request = Euler_V1_RespondToApprovalRequest()
        request.sessionID = id
        request.approvalID = approval.id
        request.decision = decision
        let response = try await backend.agent.respondToApproval(request: request, headers: [:]).value()
        approvals.removeAll { $0.id == approval.id }
        state.approvals.removeAll { $0.id == approval.id }
        await refresh()
        return response.hasRule ? response.rule : nil
    }

    func cancelAgent(_ agent: Euler_V1_Agent) async throws {
        var request = Euler_V1_CancelAgentRequest()
        request.sessionID = id
        request.agentID = agent.id
        _ = try await backend.agent.cancelAgent(request: request, headers: [:]).value()
        Haptics.firm()
    }

    func agentDetail(_ agentID: String) async throws -> Euler_V1_GetAgentResponse {
        var request = Euler_V1_GetAgentRequest()
        request.sessionID = id
        request.agentID = agentID
        return try await backend.agent.getAgent(request: request, headers: [:]).value()
    }

    func reloadJobs() async {
        var request = Euler_V1_ListJobsRequest()
        request.sessionID = id
        if let list = try? await backend.jobs.listJobs(request: request, headers: [:]).value() {
            jobs = list.jobs
            state.jobs = list.jobs
        }
    }

    func cancelJob(_ job: Euler_V1_Job) async throws {
        var request = Euler_V1_CancelJobRequest()
        request.sessionID = id
        request.jobID = job.id
        _ = try await backend.jobs.cancelJob(request: request, headers: [:]).value()
        Haptics.firm()
        await reloadJobs()
    }

    /// Changes the model later turns in this chat use.
    func setModel(_ model: String) async throws {
        var request = Euler_V1_UpdateSessionRequest()
        request.id = id
        request.model = model
        _ = try await backend.sessions.updateSession(request: request, headers: [:]).value()
        session?.model = model
    }

    /// Adopts a workspace change the workspace sheet made.
    func adoptWorkspace(_ workspace: Euler_V1_SessionWorkspace) {
        session?.workspace = workspace
    }
}
