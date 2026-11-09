import EulerAPI
import Foundation
import Observation

/// Keeps the user's one `EventService.Subscribe` stream open while the app is
/// in the foreground. It resumes after the last sequence it saw, so a
/// reconnect replays what it missed or gets `Resync`, and reconnects with
/// backoff. The app closes it in the background, which is how the server
/// knows to push instead.
@Observable
final class EventStream {
    enum Status: Equatable {
        case connecting
        case connected
        case disconnected
    }

    private(set) var status: Status = .connecting

    /// Receives every event except keepalives, in order.
    @ObservationIgnored var onEvent: (Euler_V1_Event) -> Void = { _ in }
    @ObservationIgnored private let client: any Euler_V1_EventServiceClientInterface
    @ObservationIgnored private let sleep: @Sendable (Duration) async throws -> Void
    @ObservationIgnored private var task: Task<Void, Never>?
    /// The last sequence delivered; the next connection resumes after it.
    @ObservationIgnored private(set) var sequence: UInt64 = 0

    static let initialDelay = Duration.seconds(1)
    static let maximumDelay = Duration.seconds(30)

    init(
        client: any Euler_V1_EventServiceClientInterface,
        sleep: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
    ) {
        self.client = client
        self.sleep = sleep
    }

    func start() {
        guard task == nil else { return }
        status = .connecting
        task = Task { await run() }
    }

    /// Closes the stream, as when the app leaves the foreground.
    func stop() {
        task?.cancel()
        task = nil
        status = .disconnected
    }

    private func run() async {
        var delay = Self.initialDelay
        while !Task.isCancelled {
            var request = Euler_V1_SubscribeRequest()
            request.afterSequence = sequence
            do {
                for try await response in client.subscribe(headers: [:]).messages(sending: request) {
                    // The first message, replayed or a keepalive, means the stream is up.
                    if status != .connected {
                        status = .connected
                        delay = Self.initialDelay
                    }
                    let event = response.event
                    if case .keepalive = event.payload { continue }
                    if event.sequence > 0 { sequence = event.sequence }
                    onEvent(event)
                }
            } catch {
                // Reported through `status` below; the loop reconnects.
            }
            if Task.isCancelled { return }
            status = .disconnected
            do {
                try await sleep(delay)
            } catch {
                return
            }
            delay = min(delay * 2, Self.maximumDelay)
        }
    }
}
