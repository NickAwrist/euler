import EulerAPI
import SwiftUI

/// A subagent's glyph: a mirrored 5×5 pattern seeded by its ID, colored by
/// spawn order, whose cells move while it works. A port of
/// ui/components/Agents/AgentAvatar.tsx; keep the two in step.
struct AgentAvatar: View {
    let chat: ChatStore
    let agent: Euler_V1_Agent
    var size: CGFloat = 20
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The phase that started the cycle on screen; a cycle always plays to its end.
    @State private var cycle: (start: Date, phase: AgentPhase)?
    /// The phase the next cycle plays, read when the current one ends.
    @State private var latest: AgentPhase?

    private var phase: AgentPhase? {
        agent.status == .running ? chat.phases[agent.id] ?? .thinking : nil
    }

    var body: some View {
        let glyph = AgentGlyph(agentID: agent.id)
        let color = AgentGlyph.colors[max(0, spawnOrder) % AgentGlyph.colors.count]
        TimelineView(.animation(paused: cycle == nil)) { context in
            Canvas { canvas, _ in
                let scale = size / 24
                let playing = cycle.map { ($0.phase, min(1, max(0, context.date.timeIntervalSince($0.start) / AgentGlyph.cycle))) }
                for cell in glyph.cells {
                    let offset = playing.flatMap { glyph.offset(cell, phase: $0.0, at: $0.1) } ?? .zero
                    let rect = CGRect(
                        x: (2 + CGFloat(cell.x) * AgentGlyph.pitch + offset.width) * scale,
                        y: (2 + CGFloat(cell.y) * AgentGlyph.pitch + offset.height) * scale,
                        width: AgentGlyph.cellSize * scale,
                        height: AgentGlyph.cellSize * scale
                    )
                    canvas.fill(Path(roundedRect: rect, cornerRadius: 0.9 * scale), with: .color(color))
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
        .onChange(of: phase, initial: true) { _, phase in
            latest = phase
            if let phase, cycle == nil, !reduceMotion { cycle = (.now, phase) }
        }
        .task(id: cycle?.start) {
            guard let start = cycle?.start else { return }
            let end = start.addingTimeInterval(AgentGlyph.cycle)
            do { try await Task.sleep(for: .seconds(end.timeIntervalSinceNow)) } catch { return }
            cycle = latest.map { (end, $0) }
        }
    }

    /// Colors follow spawn order so the first agents in a chat never share one.
    private var spawnOrder: Int {
        chat.subagents
            .sorted { ($0.createdAt.date, $0.id) < ($1.createdAt.date, $1.id) }
            .firstIndex { $0.id == agent.id } ?? 0
    }
}

/// The pattern and motion behind `AgentAvatar`, in the web's 24-point view box.
struct AgentGlyph {
    static let grid = 5
    static let half = (grid + 1) / 2
    static let center = (grid - 1) / 2
    static let gap: CGFloat = 0.6
    static let cellSize = (20 - CGFloat(grid - 1) * gap) / CGFloat(grid)
    static let pitch = cellSize + gap
    static let cycle: TimeInterval = 2.4
    /// The web's oklch(0.74 0.13 hue) for hues 255, 350, 22, 155, 75, 295 and 210.
    static let colors: [Color] = [0x70ADFB, 0xE887B6, 0xF28885, 0x5EC386, 0xDA9E3F, 0xB199F4, 0x00C0D8]
        .map { Color(hex: $0) }

    struct Cell: Hashable {
        let x: Int
        let y: Int
    }

    struct Move {
        let dx: Int
        let dy: Int
        let order: Int
    }

    let pattern: [[Bool]]
    let moves: [Cell: Move]

    init(agentID: String) {
        pattern = Self.pattern(agentID)
        moves = Self.slideMoves(pattern, agentID)
    }

    var cells: [Cell] {
        pattern.indices.flatMap { y in pattern[y].indices.filter { pattern[y][$0] }.map { Cell(x: $0, y: y) } }
    }

    /// A mirrored 5×5 pattern, dense enough to read as one glyph at small sizes.
    static func pattern(_ agentID: String) -> [[Bool]] {
        var random = SeededRandom(agentID)
        while true {
            let rows = (0..<grid).map { _ in (0..<half).map { _ in random.unit() < 0.55 } }
            let filled = Double(rows.joined().filter { $0 }.count) / Double(grid * half)
            if filled >= 0.45, filled <= 0.75, rows[0].contains(true), rows[grid - 1].contains(true),
               rows.contains(where: { $0[0] }) {
                return rows.map { $0 + $0.prefix(grid - half).reversed() }
            }
        }
    }

    /// Up to three mirrored pairs that slide into an empty neighbour while thinking.
    static func slideMoves(_ pattern: [[Bool]], _ agentID: String) -> [Cell: Move] {
        var random = SeededRandom("\(agentID):slide")
        var moves: [Cell: Move] = [:]
        var taken: Set<Cell> = []
        var order = 0
        let candidates = pattern.indices
            .flatMap { y in (0..<half).filter { pattern[y][$0] }.map { Cell(x: $0, y: y) } }
            .shuffled(using: &random)
        for cell in candidates where order < 3 {
            let sideways: [(Int, Int)] = cell.x < center ? [(-1, 0), (1, 0)] : []
            let directions = ([(0, -1), (0, 1)] + sideways).shuffled(using: &random)
            for (dx, dy) in directions {
                let target = Cell(x: cell.x + dx, y: cell.y + dy)
                if target.x == center, cell.x != center { continue }
                guard pattern.indices.contains(target.y), pattern[target.y].indices.contains(target.x),
                      !pattern[target.y][target.x], !taken.contains(target) else { continue }
                moves[cell] = Move(dx: dx, dy: dy, order: order)
                if cell.x != center {
                    moves[Cell(x: grid - 1 - cell.x, y: cell.y)] = Move(dx: -dx, dy: dy, order: order)
                }
                taken.insert(target)
                taken.insert(Cell(x: grid - 1 - target.x, y: target.y))
                order += 1
                break
            }
        }
        return moves
    }

    /// Where `cell` sits `progress` of the way through a cycle of `phase`, or nil if it stays put.
    func offset(_ cell: Cell, phase: AgentPhase, at progress: Double) -> CGSize? {
        Self.keyframes(cell, phase: phase, moves: moves)?.value(at: progress)
    }

    static func keyframes(_ cell: Cell, phase: AgentPhase, moves: [Cell: Move]) -> Keyframes? {
        let ease = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.6, y: 0), endControlPoint: UnitPoint(x: 0.2, y: 1))
        switch phase {
        case .thinking:
            guard let move = moves[cell] else { return nil }
            let start = Double(move.order) * 0.3
            let dx = CGFloat(move.dx) * pitch
            let dy = CGFloat(move.dy) * pitch
            return Keyframes([
                (start, 0, 0, ease),
                (start + 0.1, dx, dy, nil),
                (start + 0.22, dx, dy, ease),
                (start + 0.32, 0, 0, nil),
            ])
        case .tool:
            let start = Double(cell.y) * 0.05
            let dx = (cell.y % 2 == 1 ? 1 : -1) * pitch
            return Keyframes([
                (start, 0, 0, ease),
                (start + 0.12, dx, 0, nil),
                (start + 0.3, dx, 0, ease),
                (start + 0.45, 0, 0, nil),
            ])
        case .responding:
            let start = Double(abs(cell.x - center)) * 0.05
            let up = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.3, y: 0), endControlPoint: UnitPoint(x: 0.5, y: 1))
            let down = UnitCurve.bezier(startControlPoint: UnitPoint(x: 0.5, y: 0), endControlPoint: UnitPoint(x: 0.7, y: 1))
            return Keyframes([
                (start, 0, 0, up),
                (start + 0.1, 0, -2.6, down),
                (start + 0.2, 0, 0, nil),
                (start + 0.5, 0, 0, up),
                (start + 0.6, 0, -2.6, down),
                (start + 0.7, 0, 0, nil),
            ])
        }
    }

    /// Offsets at points in a cycle, starting and ending home. Each stop's curve
    /// eases the segment after it; without one the segment is linear.
    struct Keyframes {
        typealias Stop = (offset: Double, dx: CGFloat, dy: CGFloat, curve: UnitCurve?)
        let stops: [Stop]

        init(_ stops: [Stop]) {
            let home: Stop = (0, 0, 0, nil)
            let end: Stop = (1, 0, 0, nil)
            self.stops = [home] + stops + [end]
        }

        func value(at progress: Double) -> CGSize {
            guard let next = stops.firstIndex(where: { $0.offset > progress }), next > 0 else { return .zero }
            let from = stops[next - 1]
            let to = stops[next]
            let linear = (progress - from.offset) / (to.offset - from.offset)
            let t = CGFloat(from.curve?.value(at: linear) ?? linear)
            return CGSize(width: from.dx + (to.dx - from.dx) * t, height: from.dy + (to.dy - from.dy) * t)
        }
    }
}

/// The web's seeded generator: FNV-1a over UTF-16 code units, then mulberry32.
struct SeededRandom: RandomNumberGenerator {
    private var seed: UInt32 = 2_166_136_261

    init(_ value: String) {
        for unit in value.utf16 { seed = (seed ^ UInt32(unit)) &* 16_777_619 }
    }

    /// A value in [0, 1).
    mutating func unit() -> Double {
        seed &+= 0x6D2B_79F5
        var t = (seed ^ (seed >> 15)) &* (seed | 1)
        t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
        return Double(t ^ (t >> 14)) / 4_294_967_296
    }

    mutating func next() -> UInt64 {
        UInt64(unit() * 4_294_967_296) << 32 | UInt64(unit() * 4_294_967_296)
    }
}
