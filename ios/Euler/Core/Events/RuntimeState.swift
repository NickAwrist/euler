import EulerAPI
import Foundation

/// One chat's runtime: the snapshot `GetRuntime` returns, advanced by its
/// events. A port of `applyEvent` in ui/hooks/run/useAgentEvents.ts, so both
/// clients read the same stream the same way.
struct RuntimeState: Equatable {
    /// What an event changed, so views that read other parts stay untouched.
    struct Changes: OptionSet {
        let rawValue: Int
        static let agents = Changes(rawValue: 1 << 0)
        /// The activation started, ended, or changed its steps or segment.
        static let activation = Changes(rawValue: 1 << 1)
        /// Only streamed text grew.
        static let liveText = Changes(rawValue: 1 << 2)
        static let queued = Changes(rawValue: 1 << 3)
        static let held = Changes(rawValue: 1 << 4)
        static let history = Changes(rawValue: 1 << 5)
        static let approvals = Changes(rawValue: 1 << 6)
        /// Jobs change only with a new snapshot; events don't carry them.
        static let jobs = Changes(rawValue: 1 << 7)
        static let all: Changes = [.agents, .activation, .queued, .held, .history, .approvals, .jobs]
    }

    var sequence: UInt64 = 0
    var agents: [Euler_V1_Agent] = []
    var jobs: [Euler_V1_Job] = []
    var activation: Euler_V1_Activation?
    var queued: [Euler_V1_InboxMessage] = []
    var held = false
    var history: [Euler_V1_Message] = []
    var approvals: [Euler_V1_ToolApproval] = []

    init() {}

    init(snapshot: Euler_V1_GetRuntimeResponse) {
        sequence = snapshot.sequence
        agents = snapshot.agents
        jobs = snapshot.jobs
        activation = snapshot.hasActivation ? snapshot.activation : nil
        queued = snapshot.queued
        held = snapshot.held
        history = snapshot.history
        approvals = snapshot.approvals
    }

    var mainAgent: Euler_V1_Agent? {
        agents.first { $0.kind == .main }
    }

    /// Applies one event; events at or before `sequence` were already applied.
    @discardableResult
    mutating func apply(_ event: Euler_V1_Event) -> Changes {
        guard event.sequence > sequence else { return [] }
        sequence = event.sequence
        let mainID = mainAgent?.id
        switch event.payload {
        case .agentStatus(let change):
            guard change.hasAgent else { return [] }
            let agent = change.agent
            agents.removeAll { $0.id == agent.id }
            agents.append(agent)
            if agent.kind == .main, held != agent.held {
                held = agent.held
                return [.agents, .held]
            }
            return .agents
        case .activationStarted(let started):
            guard event.agentID == mainID, started.hasActivation else { return [] }
            activation = started.activation
            return .activation
        case .delta(let delta):
            guard var current = activation, delta.activationID == current.id else { return [] }
            activation = nil
            current.content += delta.contentDelta
            current.thinking += delta.thinkingDelta
            activation = current
            return .liveText
        case .step(let change):
            guard var current = activation, change.hasStep, change.activationID == current.id else { return [] }
            activation = nil
            let position = Int(change.position)
            // A step can fill a later position first; the gap holds placeholders until it arrives.
            while current.steps.count <= position { current.steps.append(Euler_V1_Step()) }
            current.steps[position] = change.step
            // A new model call starts a new stretch of text.
            if change.step.kind == .llmCall, change.step.status == .running {
                current.content = ""
                current.thinking = ""
            }
            activation = current
            return .activation
        case .activationEnded(let ended):
            guard ended.activationID == activation?.id else { return [] }
            activation = nil
            return .activation
        case .inboxQueued(let inbox):
            guard event.agentID == mainID else { return [] }
            let users = inbox.messages.filter { $0.kind == .user }
            guard !users.isEmpty else { return [] }
            queued += users
            return .queued
        case .transcriptAppended(let appended):
            guard appended.hasMessage else { return [] }
            history.append(appended.message)
            var changes: Changes = .history
            if appended.message.role == .user, !queued.isEmpty {
                queued.removeFirst()
                changes.insert(.queued)
            }
            if var current = activation {
                // The appended reply ends the current segment of the turn.
                current.content = ""
                current.thinking = ""
                current.steps = []
                activation = current
                changes.insert(.activation)
            }
            return changes
        case .approvalRequested(let requested):
            guard requested.hasApproval, !approvals.contains(where: { $0.id == requested.approval.id }) else { return [] }
            approvals.append(requested.approval)
            return .approvals
        case .approvalResolved(let resolved):
            guard approvals.contains(where: { $0.id == resolved.approvalID }) else { return [] }
            approvals.removeAll { $0.id == resolved.approvalID }
            return .approvals
        case .resync, .keepalive, .none:
            return []
        }
    }
}

/// What an agent is doing right now, from its latest events.
enum AgentPhase: Equatable {
    case thinking
    case responding
    case tool

    /// How `event` changes its agent's phase. A port of ui/hooks/run/agentPhases.ts.
    static func next(after event: Euler_V1_Event) -> Update {
        switch event.payload {
        case .delta(let delta):
            if !delta.contentDelta.isEmpty { return .set(.responding) }
            if !delta.thinkingDelta.isEmpty { return .set(.thinking) }
            return .keep
        case .step(let change) where change.step.status == .running:
            return .set(change.step.kind == .toolCall ? .tool : .thinking)
        case .activationEnded:
            return .end
        default:
            return .keep
        }
    }

    enum Update: Equatable {
        case keep
        case set(AgentPhase)
        case end
    }
}

extension Euler_V1_Agent {
    /// Queued, running, or blocked on a reply. A ready subagent is idle.
    var isWorking: Bool {
        [.queued, .running, .waiting].contains(status)
    }

    var isFinal: Bool {
        status == .completed || status == .cancelled
    }
}
