import Connect
import EulerAPI
import Foundation
import SwiftProtobuf

/// A server stream that records what it was sent, replays scripted messages,
/// then completes with `code`.
final class FakeServerStream<Input: ProtobufMessage, Output: ProtobufMessage>:
    ServerOnlyAsyncStreamInterface, @unchecked Sendable
{
    private let messages: [Output]
    private let code: Code
    private(set) var sent: [Input] = []

    init(messages: [Output], code: Code) {
        self.messages = messages
        self.code = code
    }

    func send(_ input: Input) throws {
        sent.append(input)
    }

    func results() -> AsyncStream<StreamResult<Output>> {
        AsyncStream { continuation in
            for message in messages {
                continuation.yield(.message(message))
            }
            let error = code == .ok
                ? nil
                : ConnectError(code: code, message: "dropped", exception: nil, details: [], metadata: [:])
            continuation.yield(.complete(code: code, error: error, trailers: nil))
            continuation.finish()
        }
    }

    func cancel() {}
}

/// Builds events as the server sends them.
enum Events {
    static func event(_ sequence: UInt64, agent: String = "main", session: String = "chat", _ payload: Euler_V1_Event.OneOf_Payload) -> Euler_V1_Event {
        var event = Euler_V1_Event()
        event.sequence = sequence
        event.sessionID = session
        event.agentID = agent
        event.payload = payload
        return event
    }

    static func agent(_ id: String, kind: Euler_V1_Agent.Kind = .main, status: Euler_V1_Agent.Status = .running, held: Bool = false) -> Euler_V1_Event.OneOf_Payload {
        var change = Euler_V1_AgentStatusChanged()
        change.agent.id = id
        change.agent.kind = kind
        change.agent.status = status
        change.agent.held = held
        return .agentStatus(change)
    }

    static func started(_ activation: String, agent: String = "main") -> Euler_V1_Event.OneOf_Payload {
        var started = Euler_V1_ActivationStarted()
        started.activation.id = activation
        started.activation.agentID = agent
        return .activationStarted(started)
    }

    static func delta(_ activation: String, content: String = "", thinking: String = "") -> Euler_V1_Event.OneOf_Payload {
        var delta = Euler_V1_Delta()
        delta.activationID = activation
        delta.contentDelta = content
        delta.thinkingDelta = thinking
        return .delta(delta)
    }

    static func step(_ activation: String, position: Int32, kind: Euler_V1_Step.Kind, status: Euler_V1_Step.Status, tool: String? = nil) -> Euler_V1_Event.OneOf_Payload {
        var change = Euler_V1_StepChanged()
        change.activationID = activation
        change.position = position
        change.step.kind = kind
        change.step.status = status
        if let tool { change.step.toolName = tool }
        return .step(change)
    }

    static func ended(_ activation: String, _ outcome: Euler_V1_ActivationEnded.Outcome = .done) -> Euler_V1_Event.OneOf_Payload {
        var ended = Euler_V1_ActivationEnded()
        ended.activationID = activation
        ended.outcome = outcome
        return .activationEnded(ended)
    }

    static func appended(_ role: Euler_V1_Message.Role, _ content: String) -> Euler_V1_Event.OneOf_Payload {
        var appended = Euler_V1_TranscriptAppended()
        appended.message.role = role
        appended.message.content = content
        return .transcriptAppended(appended)
    }

    static func queued(_ id: Int64, _ content: String, kind: Euler_V1_InboxMessage.Kind = .user) -> Euler_V1_Event.OneOf_Payload {
        var inbox = Euler_V1_InboxQueued()
        var message = Euler_V1_InboxMessage()
        message.id = id
        message.kind = kind
        message.content = content
        inbox.messages = [message]
        return .inboxQueued(inbox)
    }

    static func approval(_ id: String) -> Euler_V1_Event.OneOf_Payload {
        var requested = Euler_V1_ApprovalRequested()
        requested.approval.id = id
        requested.approval.tool = "bash"
        return .approvalRequested(requested)
    }

    static func resolved(_ id: String) -> Euler_V1_Event.OneOf_Payload {
        var resolved = Euler_V1_ApprovalResolved()
        resolved.approvalID = id
        return .approvalResolved(resolved)
    }
}
