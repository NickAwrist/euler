import EulerAPI
import Observation
import QuartzCore

/// The turn streaming in right now. Token deltas arrive faster than the screen
/// refreshes, so text changes publish at most once per display frame; a new
/// step, segment or the turn ending publish at once.
@Observable
final class LiveReply {
    private(set) var activation: Euler_V1_Activation?

    @ObservationIgnored private var pending: Euler_V1_Activation?
    @ObservationIgnored private var hasPending = false
    @ObservationIgnored private var frames: FrameTicker?
    /// Replaces the display link in tests, which flush by hand.
    @ObservationIgnored var schedulesFrames = true

    /// Steps so far, without placeholders for positions still on their way.
    var steps: [Euler_V1_Step] {
        activation?.steps.filter { $0.kind != .unspecified } ?? []
    }

    func show(_ next: Euler_V1_Activation?, coalesce: Bool) {
        guard coalesce else {
            pending = nil
            hasPending = false
            frames?.stop()
            activation = next
            return
        }
        pending = next
        hasPending = true
        guard schedulesFrames else { return }
        if frames == nil { frames = FrameTicker { [weak self] in self?.flush() } }
        frames?.start()
    }

    /// Publishes coalesced text, as the next frame does.
    func flush() {
        frames?.stop()
        guard hasPending else { return }
        hasPending = false
        activation = pending
        pending = nil
    }
}

/// Calls `tick` on the next display frame after each `start`.
private final class FrameTicker: NSObject {
    private let tick: () -> Void
    private var link: CADisplayLink?

    init(tick: @escaping () -> Void) {
        self.tick = tick
    }

    func start() {
        guard link == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(fire))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    @objc private func fire() {
        tick()
    }
}
