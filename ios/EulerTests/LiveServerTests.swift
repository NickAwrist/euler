import Connect
import EulerAPI
import Foundation
import Testing
@testable import Euler

/// Runs against a real server when EULER_LIVE_SERVER and EULER_LIVE_USER are
/// set in the test environment; skipped otherwise.
@Suite(.enabled(if: LiveServer.configured))
struct LiveServerTests {
    @Test func listsSessionsAndStreamsKeepalives() async throws {
        let backend = try #require(LiveServer.backend)
        let sessions = try await backend.sessions.listSessions(request: .init(), headers: [:]).value()
        #expect(sessions.sessions.isEmpty == false)
        let started = ContinuousClock.now
        var request = Euler_V1_SubscribeRequest()
        request.afterSequence = 0
        var sawResync = false
        for try await response in backend.events.subscribe(headers: [:]).messages(sending: request) {
            switch response.event.payload {
            case .resync: sawResync = true
            case .keepalive:
                #expect(sawResync)
                #expect(ContinuousClock.now - started < .seconds(8))
                return
            default: continue
            }
        }
        Issue.record("The stream ended before a keepalive")
    }
}

nonisolated enum LiveServer {
    static let environment = ProcessInfo.processInfo.environment
    static var configured: Bool { backend != nil }
    static var backend: Backend? {
        guard let address = environment["EULER_LIVE_SERVER"].flatMap(URL.init(string:)),
              let user = environment["EULER_LIVE_USER"] else { return nil }
        return Backend(baseURL: address, userID: user)
    }
}
