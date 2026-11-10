import Connect
import EulerAPI
import Testing
@testable import Euler

/// Hands out one scripted connection per `subscribe` call and keeps them for inspection.
private final class ScriptedEventClient: Euler_V1_EventServiceClientInterface, @unchecked Sendable {
    var connections: [[Euler_V1_SubscribeResponse]]
    private(set) var opened: [FakeServerStream<Euler_V1_SubscribeRequest, Euler_V1_SubscribeResponse>] = []

    init(connections: [[Euler_V1_SubscribeResponse]]) {
        self.connections = connections
    }

    func subscribe(headers: Headers) -> any ServerOnlyAsyncStreamInterface<Euler_V1_SubscribeRequest, Euler_V1_SubscribeResponse> {
        let messages = connections.isEmpty ? [] : connections.removeFirst()
        let stream = FakeServerStream<Euler_V1_SubscribeRequest, Euler_V1_SubscribeResponse>(messages: messages, code: .unavailable)
        opened.append(stream)
        return stream
    }
}

private func response(_ event: Euler_V1_Event) -> Euler_V1_SubscribeResponse {
    var response = Euler_V1_SubscribeResponse()
    response.event = event
    return response
}

@MainActor
struct EventStreamTests {
    @Test func resumesAfterTheLastSequenceWithGrowingBackoff() async {
        var keepalive = Euler_V1_Event()
        keepalive.payload = .keepalive(.init())
        let client = ScriptedEventClient(connections: [
            [],
            [response(Events.event(41, Events.appended(.user, "a"))), response(keepalive)],
            [],
        ])
        var delays: [Duration] = []
        var events: [UInt64] = []
        let finished = AsyncStream<Void>.makeStream()
        let stream = EventStream(client: client) { delay in
            await MainActor.run { delays.append(delay) }
            if await MainActor.run(body: { delays.count }) == 3 {
                finished.continuation.yield()
                try await Task.sleep(for: .seconds(60))
            }
        }
        stream.onEvent = { events.append($0.sequence) }

        stream.start()
        for await _ in finished.stream { break }
        stream.stop()

        // A dropped first connection backs off; a connection that delivered resets the delay.
        #expect(delays == [.seconds(1), .seconds(1), .seconds(2)])
        // Keepalives are not events.
        #expect(events == [41])
        #expect(client.opened.map { $0.sent.first?.afterSequence } == [0, 0, 41])
        #expect(stream.status == .disconnected)
    }
}
