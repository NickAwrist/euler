import Foundation

/// The web's math delimiter policy (`normalizeMathDelimiters` in
/// ui/components/MarkdownMessage.tsx). `$$…$$`, `\(…\)` and `\[…\]` are always
/// math. A single `$…$` pair is math only under Pandoc's rules: the opening `$`
/// is followed by a non-space, the closing `$` follows a non-space and is not
/// followed by a digit, and both are on one line. So "$5 and $10" stays text.
/// Escaped `\$` is a literal dollar. Code is never touched.
enum MathDelimiters {
    /// One math span in reply text.
    struct Span: Equatable {
        var tex: String
        /// Fenced on its own lines (`$$` above and below), shown as a block.
        var display: Bool
    }

    // Swift regex has no lookbehind, so the character before a single `$` is
    // matched as group 1 and put back.
    nonisolated(unsafe) private static let delimiters = /\$\$([\s\S]*?)\$\$|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|(^|[^\\$])\$(?![\s$])((?:\\.|[^$\\\n])*?[^\s\\$])\$(?![\d$])/

    /// Rewrites math as `$$…$$`, leaving code untouched, so later passes see one form.
    static func normalize(_ markdown: String) -> String {
        guard markdown.contains("$") || markdown.contains("\\(") || markdown.contains("\\[") else { return markdown }
        return CodeSpans.mapText(markdown) { text in
            text.replacing(delimiters) { match in
                let output = match.output
                if let tex = output.2 ?? output.3 { return "$$\(tex)$$" }
                if let tex = output.5 { return "\(output.4 ?? "")$$\(tex)$$" }
                return String(output.0)
            }
        }
    }
}

/// Splits Markdown into code (fenced blocks and inline spans) and the text
/// between it, so text-only rewrites leave code exactly as written.
enum CodeSpans {
    static func mapText(_ markdown: String, _ transform: (String) -> String) -> String {
        var result = ""
        var text = ""
        var fence: Substring?
        for line in markdown.split(separator: "\n", omittingEmptySubsequences: false).enumerated() {
            let raw = line.element
            let separator = line.offset == 0 ? "" : "\n"
            let trimmed = raw.drop { $0 == " " }
            if let open = fence {
                result += separator + raw
                if trimmed.hasPrefix(open), trimmed.drop(while: { $0 == open.first }).allSatisfy(\.isWhitespace) {
                    fence = nil
                }
                continue
            }
            if let marker = fenceMarker(trimmed) {
                result += transform(text) + separator + raw
                text = ""
                fence = marker
                continue
            }
            text += separator + raw
        }
        return result + mapInline(text, transform)
    }

    /// The opening run of a code fence (three or more backticks or tildes), if `line` starts one.
    private static func fenceMarker(_ line: Substring) -> Substring? {
        guard let first = line.first, first == "`" || first == "~" else { return nil }
        let run = line.prefix { $0 == first }
        return run.count >= 3 ? run : nil
    }

    /// Applies `transform` outside inline code spans, which close on a backtick run of the same length.
    private static func mapInline(_ text: String, _ transform: (String) -> String) -> String {
        var result = ""
        var plain = ""
        var index = text.startIndex
        while index < text.endIndex {
            guard text[index] == "`" else {
                plain.append(text[index])
                index = text.index(after: index)
                continue
            }
            let run = text[index...].prefix { $0 == "`" }
            let afterOpen = run.endIndex
            if let close = text[afterOpen...].firstRange(of: run),
               close.upperBound == text.endIndex || text[close.upperBound] != "`" {
                result += transform(plain) + text[index..<close.upperBound]
                plain = ""
                index = close.upperBound
            } else {
                plain += run
                index = afterOpen
            }
        }
        return result + transform(plain)
    }
}
