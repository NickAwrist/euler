import Testing
@testable import Euler

/// The web's math policy (tests/ui/mathDelimiters.test.ts) and reply fixtures.
struct MathDelimiterTests {
    @Test func rewritesLaTeXDelimitersAndTightSingleDollarPairs() {
        #expect(MathDelimiters.normalize("So $2x + 1.00 = 1.10$ holds.") == "So $$2x + 1.00 = 1.10$$ holds.")
        #expect(MathDelimiters.normalize(#"Let \(x^2\) and \[y\]."#) == "Let $$x^2$$ and $$y$$.")
        #expect(MathDelimiters.normalize("$$\n\\frac{a}{b}\n$$") == "$$\n\\frac{a}{b}\n$$")
    }

    @Test(arguments: [
        "The bat costs $1.05 and the ball costs $0.05.",
        "Budget $5-$10 per item.",
        "Prices: $20/$30.",
        #"Pay \$5 and \$6."#,
    ])
    func leavesCurrencyAndEscapedDollarsAsText(_ text: String) {
        #expect(MathDelimiters.normalize(text) == text)
    }

    @Test func leavesCodeUntouched() {
        let markdown = "```sh\necho $HOME$PATH\n```\n\nRun `$x$` then $y$."
        #expect(MathDelimiters.normalize(markdown) == "```sh\necho $HOME$PATH\n```\n\nRun `$x$` then $$y$$.")
    }
}

struct MarkdownDocumentTests {
    @Test func fencedMathIsADisplayBlockAndInlineMathStaysInText() {
        let blocks = MarkdownDocument("The roots of $ax^2+c=0$ are\n\n$$\nx = \\pm\\sqrt{-c/a}\n$$").blocks
        guard case .paragraph(let inline) = blocks.first else { Issue.record("expected a paragraph"); return }
        #expect(inline.segments.contains(.math("ax^2+c=0")))
        #expect(blocks.last == .math("x = \\pm\\sqrt{-c/a}"))
    }

    @Test func anEquationAloneInItsParagraphIsDisplayed() {
        #expect(MarkdownDocument("$$E = mc^2$$").blocks == [.math("E = mc^2")])
    }

    @Test func singleNewlinesBreakLines() {
        guard case .paragraph(let inline) = MarkdownDocument("one\ntwo").blocks.first,
              case .text(let text) = inline.segments.first
        else { Issue.record("expected text"); return }
        #expect(String(text.characters) == "one\ntwo")
    }

    @Test func tablesTaskListsAndCodeParse() {
        let blocks = MarkdownDocument("""
        | A | B |
        |---|--:|
        | 1 | 2 |

        - [x] done
        - [ ] todo

        ```swift
        let x = 1
        ```
        """).blocks
        guard case .table(let table) = blocks[0] else { Issue.record("expected a table"); return }
        #expect(table.head.count == 2)
        #expect(table.rows.count == 1)
        guard case .list(false, _, let items) = blocks[1] else { Issue.record("expected a list"); return }
        #expect(items.map(\.checkbox) == [true, false])
        #expect(blocks[2] == .code(language: "swift", code: "let x = 1"))
    }

    @Test func flattenedPipeTablesAreSplitIntoRows() {
        guard case .table(let table) = MarkdownDocument("| A | B | |---|---| | 1 | 2 |").blocks.first else {
            Issue.record("expected a table"); return
        }
        #expect(table.rows.count == 1)
    }

    @Test func comfyUIURLsBecomeImages() {
        let blocks = MarkdownDocument(#"Here: {"image_url": "/api/comfyui/view/out.png"}"#).blocks
        #expect(blocks.contains(.image(url: "/api/comfyui/view/out.png", alt: "Generated Image")))
        let bare = MarkdownDocument("Saved to /api/comfyui/view/a.png.").blocks
        #expect(bare.contains(.image(url: "/api/comfyui/view/a.png", alt: "Generated Image")))
    }
}

@MainActor
struct MathRendererTests {
    @Test(arguments: [#"\frac{-b \pm \sqrt{b^2-4ac}}{2a}"#, #"\sum_{i=1}^n i^2"#, #"\int_0^1 x^2\,dx"#, #"\begin{pmatrix} a & b \\ c & d \end{pmatrix}"#])
    func typesetsCommonFormulas(_ tex: String) {
        let rendered = MathRenderer.render(tex, display: true, fontSize: 19, color: .white)
        #expect(rendered != nil)
        #expect((rendered?.image.size.width ?? 0) > 0)
    }

    @Test func formulasSwiftMathCantTypesetReturnNil() {
        #expect(MathRenderer.render(#"\notacommand{x}"#, display: false, fontSize: 17, color: .white) == nil)
    }
}
