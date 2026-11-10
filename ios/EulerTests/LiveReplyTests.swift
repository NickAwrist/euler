import EulerAPI
import Testing
@testable import Euler

@MainActor
struct LiveReplyTests {
    private func activation(_ content: String) -> Euler_V1_Activation {
        var activation = Euler_V1_Activation()
        activation.id = "turn"
        activation.content = content
        return activation
    }

    @Test func textPublishesOncePerFrame() {
        let live = LiveReply()
        live.schedulesFrames = false
        live.show(activation(""), coalesce: false)
        live.show(activation("Hel"), coalesce: true)
        live.show(activation("Hello"), coalesce: true)
        #expect(live.activation?.content == "")
        live.flush()
        #expect(live.activation?.content == "Hello")
    }

    @Test func structuralChangesPublishAtOnceAndDropPendingText() {
        let live = LiveReply()
        live.schedulesFrames = false
        live.show(activation("partial"), coalesce: true)
        live.show(nil, coalesce: false)
        #expect(live.activation == nil)
        live.flush()
        #expect(live.activation == nil)
    }

    @Test func placeholderStepsAreHidden() {
        let live = LiveReply()
        var running = activation("")
        running.steps = [Euler_V1_Step(), { var step = Euler_V1_Step(); step.kind = .toolCall; return step }()]
        live.show(running, coalesce: false)
        #expect(live.steps.map(\.kind) == [.toolCall])
    }
}
