import CoreGraphics
import Testing
@testable import Euler

struct AgentGlyphTests {
    private func rows(_ id: String) -> String {
        AgentGlyph.pattern(id).map { $0.map { $0 ? "#" : "." }.joined() }.joined(separator: "/")
    }

    /// Patterns from the web's agentPattern, so an agent looks the same in both clients.
    @Test func matchesTheWebPattern() {
        #expect(rows("agent_1") == ".#.#./#####/.#.#./#.#.#/#...#")
        #expect(rows("01JQ3M8Z5X7K2P9R4T6V8W0Y1A") == "#####/#####/.#.#./.###./#.#.#")
        #expect(rows("é✓") == ".#.#./.###./.###./#.#.#/.#.#.")
    }

    @Test func slidesMirroredPairsIntoEmptyCells() {
        let glyph = AgentGlyph(agentID: "agent_1")
        #expect(!glyph.moves.isEmpty)
        for (cell, move) in glyph.moves {
            #expect(glyph.pattern[cell.y][cell.x])
            #expect(!glyph.pattern[cell.y + move.dy][cell.x + move.dx])
            let mirror = glyph.moves[.init(x: AgentGlyph.grid - 1 - cell.x, y: cell.y)]
            #expect(mirror?.dx == -move.dx && mirror?.dy == move.dy && mirror?.order == move.order)
        }
    }

    @Test(arguments: [AgentPhase.thinking, .tool, .responding])
    func everyCycleStartsAndEndsHome(phase: AgentPhase) {
        let glyph = AgentGlyph(agentID: "agent_1")
        let moving = glyph.cells.compactMap { cell in
            AgentGlyph.keyframes(cell, phase: phase, moves: glyph.moves)
        }
        #expect(!moving.isEmpty)
        for keyframes in moving {
            #expect(keyframes.value(at: 0) == .zero)
            #expect(keyframes.value(at: 1) == .zero)
            #expect((0...100).contains { keyframes.value(at: Double($0) / 100) != .zero })
        }
    }
}
