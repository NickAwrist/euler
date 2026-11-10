import EulerAPI
import Testing
@testable import Euler

/// The reducer reads the stream as ui/hooks/run/useAgentEvents.ts does.
@MainActor
struct RuntimeStateTests {
    private func running() -> RuntimeState {
        var state = RuntimeState()
        state.apply(Events.event(1, Events.agent("main")))
        state.apply(Events.event(2, Events.started("turn")))
        return state
    }

    @Test func ignoresEventsAtOrBeforeTheSnapshotSequence() {
        var response = Euler_V1_GetRuntimeResponse()
        response.sequence = 10
        var state = RuntimeState(snapshot: response)
        #expect(state.apply(Events.event(10, Events.appended(.user, "old"))) == [])
        #expect(state.apply(Events.event(9, Events.appended(.user, "older"))) == [])
        #expect(state.apply(Events.event(11, Events.appended(.user, "new"))) == .history)
        #expect(state.history.map(\.content) == ["new"])
    }

    @Test func streamsTextIntoTheMainAgentsActivationOnly() {
        var state = running()
        #expect(state.apply(Events.event(3, Events.delta("turn", content: "Hel", thinking: "hmm"))) == .liveText)
        state.apply(Events.event(4, Events.delta("turn", content: "lo")))
        // Another activation's tokens, such as a subagent's, change nothing.
        #expect(state.apply(Events.event(5, Events.delta("other", content: "!"))) == [])
        #expect(state.activation?.content == "Hello")
        #expect(state.activation?.thinking == "hmm")

        var other = RuntimeState()
        other.apply(Events.event(1, Events.agent("main")))
        #expect(other.apply(Events.event(2, agent: "helper", Events.started("sub", agent: "helper"))) == [])
        #expect(other.activation == nil)
    }

    @Test func aNewModelCallStartsANewStretchOfText() {
        var state = running()
        state.apply(Events.event(3, Events.delta("turn", content: "First", thinking: "t")))
        #expect(state.apply(Events.event(4, Events.step("turn", position: 0, kind: .toolCall, status: .running, tool: "bash"))) == .activation)
        #expect(state.activation?.content == "First")
        state.apply(Events.event(5, Events.step("turn", position: 1, kind: .llmCall, status: .running)))
        #expect(state.activation?.content == "")
        #expect(state.activation?.thinking == "")
        #expect(state.activation?.steps.count == 2)
    }

    @Test func stepsCanArriveOutOfOrder() {
        var state = running()
        state.apply(Events.event(3, Events.step("turn", position: 2, kind: .toolCall, status: .running, tool: "read")))
        #expect(state.activation?.steps.map(\.kind) == [.unspecified, .unspecified, .toolCall])
        state.apply(Events.event(4, Events.step("turn", position: 0, kind: .llmCall, status: .done)))
        #expect(state.activation?.steps.map(\.kind) == [.llmCall, .unspecified, .toolCall])
    }

    @Test func anAppendedMessageEndsTheSegmentAndTakesItsQueuedTurn() {
        var state = running()
        state.apply(Events.event(3, Events.queued(7, "next")))
        state.apply(Events.event(4, Events.delta("turn", content: "Reply")))
        let changes = state.apply(Events.event(5, Events.appended(.assistant, "Reply")))
        #expect(changes == [.history, .activation])
        #expect(state.activation?.content == "")
        #expect(state.queued.map(\.content) == ["next"])
        #expect(state.apply(Events.event(6, Events.appended(.user, "next"))).contains(.queued))
        #expect(state.queued.isEmpty)
    }

    @Test func queuesOnlyTheMainAgentsUserMessages() {
        var state = running()
        #expect(state.apply(Events.event(3, Events.queued(1, "report", kind: .result))) == [])
        #expect(state.apply(Events.event(4, agent: "helper", Events.queued(2, "task"))) == [])
        #expect(state.apply(Events.event(5, Events.queued(3, "hi"))) == .queued)
        #expect(state.queued.map(\.id) == [3])
    }

    @Test func endsOnlyTheCurrentActivation() {
        var state = running()
        #expect(state.apply(Events.event(3, Events.ended("stale"))) == [])
        #expect(state.apply(Events.event(4, Events.ended("turn"))) == .activation)
        #expect(state.activation == nil)
    }

    @Test func approvalsAreAddedOnceAndRemovedWhenResolved() {
        var state = running()
        #expect(state.apply(Events.event(3, Events.approval("a"))) == .approvals)
        #expect(state.apply(Events.event(4, Events.approval("a"))) == [])
        #expect(state.apply(Events.event(5, Events.resolved("missing"))) == [])
        #expect(state.apply(Events.event(6, Events.resolved("a"))) == .approvals)
        #expect(state.approvals.isEmpty)
    }

    @Test func theMainAgentsHoldFollowsItsStatus() {
        var state = running()
        #expect(state.apply(Events.event(3, Events.agent("main", held: true))) == [.agents, .held])
        #expect(state.held)
        #expect(state.apply(Events.event(4, Events.agent("helper", kind: .general, held: true))) == .agents)
        #expect(state.agents.count == 2)
    }

    @Test func phasesFollowDeltasStepsAndTheEnd() {
        #expect(AgentPhase.next(after: Events.event(1, Events.delta("t", thinking: "x"))) == .set(.thinking))
        #expect(AgentPhase.next(after: Events.event(1, Events.delta("t", content: "x"))) == .set(.responding))
        #expect(AgentPhase.next(after: Events.event(1, Events.step("t", position: 0, kind: .toolCall, status: .running))) == .set(.tool))
        #expect(AgentPhase.next(after: Events.event(1, Events.step("t", position: 0, kind: .toolCall, status: .done))) == .keep)
        #expect(AgentPhase.next(after: Events.event(1, Events.ended("t"))) == .end)
    }
}

struct ArrivalTrackerTests {
    private func message(_ id: Int64, held: Bool = false) -> Euler_V1_InboxMessage {
        var message = Euler_V1_InboxMessage()
        message.id = id
        message.held = held
        return message
    }

    @Test func aMessageQueuedWhileIdleIsArrivingUntilItsTurnTakesIt() {
        var tracker = ArrivalTracker()
        tracker.noteQueued([message(1)], idle: true)
        #expect(tracker.split([message(1)]).arriving.map(\.id) == [1])
        // The turn started; the message is still its own until saved.
        #expect(tracker.split([message(1)]).waiting.isEmpty)
        #expect(tracker.split([]).arriving.isEmpty)
    }

    @Test func aMessageQueuedBehindATurnWaits() {
        var tracker = ArrivalTracker()
        tracker.noteQueued([message(1)], idle: false)
        #expect(tracker.split([message(1)]).waiting.map(\.id) == [1])
        // A later message doesn't change what an earlier one was.
        tracker.noteQueued([message(1), message(2)], idle: true)
        let split = tracker.split([message(1), message(2)])
        #expect(split.waiting.map(\.id) == [1])
        #expect(split.arriving.map(\.id) == [2])
    }

    @Test func heldAndUnannouncedMessagesWait() {
        var tracker = ArrivalTracker()
        tracker.noteQueued([message(1, held: true)], idle: true)
        // Message 2 came with a refetched runtime, which doesn't say what the agent was doing.
        let split = tracker.split([message(1, held: true), message(2)])
        #expect(split.arriving.isEmpty)
        #expect(split.waiting.map(\.id) == [1, 2])
    }

    @Test func aTurnThatNeverStartsLeavesItsMessagesQueued() {
        var tracker = ArrivalTracker()
        tracker.noteQueued([message(1)], idle: true)
        tracker.expire()
        #expect(tracker.split([message(1)]).waiting.map(\.id) == [1])
    }
}
