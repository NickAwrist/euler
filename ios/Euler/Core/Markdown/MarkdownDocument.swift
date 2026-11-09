import Foundation
import Markdown

/// A reply parsed into the blocks the transcript renders. Parsing follows the
/// web's pipeline: GFM, single newlines as line breaks (remark-breaks), the
/// math policy in `MathDelimiters`, and ComfyUI image URLs shown as images.
struct MarkdownDocument: Equatable {
    var blocks: [MarkdownBlock]

    init(_ source: String) {
        var math: [String] = []
        let prepared = Self.extractMath(
            MathDelimiters.normalize(Self.convertComfyUIURLs(Self.unflattenPipeTables(source))),
            into: &math
        )
        let document = Document(parsing: prepared)
        let converter = Converter(math: math)
        blocks = converter.blocks(document.blockChildren)
    }

    static let comfyUIViewPrefix = "/api/comfyui/view/"
    /// Private-use characters around a math index, which no reply contains.
    private static let mathOpen: Character = "\u{E000}"
    private static let mathClose: Character = "\u{E001}"

    /// Fenced `$$` blocks become `math` code blocks; inline `$$…$$` becomes a placeholder.
    private static func extractMath(_ markdown: String, into math: inout [String]) -> String {
        guard markdown.contains("$$") else { return markdown }
        return CodeSpans.mapText(markdown) { text in
            let fenced = text.replacing(/(?m)^[ \t]*\$\$[ \t]*\n([\s\S]*?)\n[ \t]*\$\$[ \t]*$/) { match in
                "```math\n\(match.output.1)\n```"
            }
            return fenced.replacing(/\$\$([\s\S]+?)\$\$/) { match in
                math.append(String(match.output.1))
                return "\(mathOpen)\(math.count - 1)\(mathClose)"
            }
        }
    }

    /// GFM tables need newline-separated rows; streamed model text often puts them on one line.
    private static func unflattenPipeTables(_ markdown: String) -> String {
        guard !markdown.contains("\n"), markdown.matches(of: /\|\s+\|/).count >= 2 else { return markdown }
        return markdown.replacing(/\|\s+\|/) { _ in "|\n|" }
    }

    /// Generated image URLs that models write as JSON, quoted or bare become Markdown images.
    private static func convertComfyUIURLs(_ markdown: String) -> String {
        guard markdown.contains(comfyUIViewPrefix) else { return markdown }
        var result = markdown.replacing(/\{\s*"[^"]*"\s*:\s*"(\/api\/comfyui\/view\/[^"]+)"\s*\}/) { match in
            "![Generated Image](\(match.output.1))"
        }
        result = result.replacing(/(^|[^(])"(\/api\/comfyui\/view\/[^"]+)"/) { match in
            "\(match.output.1)![Generated Image](\(match.output.2))"
        }
        return result.replacing(/(^|[^(\]"\/])(\/api\/comfyui\/view\/[^\s"')>\]]*[^\s"')>\].,;:!?])/) { match in
            "\(match.output.1)![Generated Image](\(match.output.2))"
        }
    }

    /// Walks swift-markdown's tree into `MarkdownBlock`s.
    private struct Converter {
        let math: [String]

        func blocks(_ children: some Sequence<BlockMarkup>) -> [MarkdownBlock] {
            children.flatMap { block($0) }
        }

        func block(_ markup: BlockMarkup) -> [MarkdownBlock] {
            switch markup {
            case let paragraph as Paragraph:
                return paragraphBlocks(paragraph)
            case let heading as Heading:
                return [.heading(level: heading.level, inline(heading.inlineChildren))]
            case let list as UnorderedList:
                return [.list(ordered: false, start: 1, items: list.listItems.map(item))]
            case let list as OrderedList:
                return [.list(ordered: true, start: Int(list.startIndex), items: list.listItems.map(item))]
            case let quote as BlockQuote:
                return [.quote(blocks(quote.blockChildren))]
            case let code as CodeBlock:
                let body = code.code.hasSuffix("\n") ? String(code.code.dropLast()) : code.code
                if code.language == "math" { return [.math(body)] }
                return [.code(language: code.language.flatMap { $0.isEmpty ? nil : $0 }, code: body)]
            case let table as Markdown.Table:
                return [.table(MarkdownTable(
                    alignments: table.columnAlignments,
                    head: table.head.cells.map { inline($0.inlineChildren) },
                    rows: table.body.rows.map { row in row.cells.map { inline($0.inlineChildren) } }
                ))]
            case is ThematicBreak:
                return [.rule]
            case let html as HTMLBlock:
                return [.paragraph(MarkdownInline(segments: [.text(AttributedString(html.rawHTML.trimmingCharacters(in: .newlines)))]))]
            default:
                return blocks(markup.children.compactMap { $0 as? BlockMarkup })
            }
        }

        func item(_ item: ListItem) -> MarkdownListItem {
            MarkdownListItem(
                checkbox: item.checkbox.map { $0 == .checked },
                blocks: blocks(item.blockChildren)
            )
        }

        /// A paragraph's text, with images and lone math pulled out as their own blocks.
        func paragraphBlocks(_ paragraph: Paragraph) -> [MarkdownBlock] {
            var result: [MarkdownBlock] = []
            var pending: [InlineMarkup] = []
            func flush() {
                let content = inline(pending)
                pending = []
                guard !content.isBlank else { return }
                // An equation alone in its paragraph reads best as a display block.
                if content.segments.count == 1, case .math(let tex) = content.segments[0] {
                    result.append(.math(tex))
                } else {
                    result.append(.paragraph(content))
                }
            }
            for child in paragraph.inlineChildren {
                if let image = child as? Markdown.Image, let source = image.source {
                    flush()
                    result.append(.image(url: source, alt: image.plainText))
                } else {
                    pending.append(child)
                }
            }
            flush()
            return result
        }

        func inline(_ children: some Sequence<InlineMarkup>) -> MarkdownInline {
            var text = AttributedString()
            for child in children { append(child, to: &text, intent: []) }
            return MarkdownInline(splitting: text, math: math)
        }

        private func append(_ markup: InlineMarkup, to text: inout AttributedString, intent: InlinePresentationIntent, link: URL? = nil) {
            func run(_ string: String, _ extra: InlinePresentationIntent = []) {
                var piece = AttributedString(string)
                let combined = intent.union(extra)
                if !combined.isEmpty { piece.inlinePresentationIntent = combined }
                if let link { piece.link = link }
                text += piece
            }
            switch markup {
            case let plain as Markdown.Text:
                run(plain.string)
            case is SoftBreak, is LineBreak:
                // remark-breaks: every newline in a paragraph is a line break.
                run("\n")
            case let code as InlineCode:
                run(code.code, .code)
            case let html as InlineHTML:
                run(html.rawHTML)
            case let image as Markdown.Image:
                run(image.plainText)
            case let anchor as Markdown.Link:
                let url = anchor.destination.flatMap(URL.init(string:))
                for child in anchor.inlineChildren {
                    append(child, to: &text, intent: intent, link: url ?? link)
                }
            case let container as InlineContainer:
                var nested = intent
                if container is Emphasis { nested.insert(.emphasized) }
                if container is Strong { nested.insert(.stronglyEmphasized) }
                if container is Strikethrough { nested.insert(.strikethrough) }
                for child in container.inlineChildren {
                    append(child, to: &text, intent: nested, link: link)
                }
            default:
                run(markup.format())
            }
        }
    }
}

indirect enum MarkdownBlock: Equatable {
    case paragraph(MarkdownInline)
    case heading(level: Int, MarkdownInline)
    case list(ordered: Bool, start: Int, items: [MarkdownListItem])
    case quote([MarkdownBlock])
    case code(language: String?, code: String)
    case math(String)
    case table(MarkdownTable)
    case image(url: String, alt: String)
    case rule
}

struct MarkdownListItem: Equatable {
    /// Checked or not for a task list item; nil for a plain item.
    var checkbox: Bool?
    var blocks: [MarkdownBlock]
}

struct MarkdownTable: Equatable {
    var alignments: [Markdown.Table.ColumnAlignment?]
    var head: [MarkdownInline]
    var rows: [[MarkdownInline]]
}

/// Inline text with math spans between its runs.
struct MarkdownInline: Equatable {
    enum Segment: Equatable {
        case text(AttributedString)
        case math(String)
    }

    var segments: [Segment]

    var isBlank: Bool {
        segments.allSatisfy { segment in
            if case .text(let text) = segment {
                return String(text.characters).allSatisfy(\.isWhitespace)
            }
            return false
        }
    }

    init(segments: [Segment]) {
        self.segments = segments
    }

    /// Splits `text` at math placeholders, looking each one up in `math`.
    init(splitting text: AttributedString, math: [String]) {
        var segments: [Segment] = []
        let characters = text.characters
        var start = text.startIndex
        while let open = characters[start...].firstIndex(of: "\u{E000}"),
              let close = characters[open...].firstIndex(of: "\u{E001}") {
            if open > start { segments.append(.text(AttributedString(text[start..<open]))) }
            let indexText = String(characters[characters.index(after: open)..<close])
            if let index = Int(indexText), math.indices.contains(index) {
                segments.append(.math(math[index]))
            }
            start = characters.index(after: close)
        }
        if start < text.endIndex { segments.append(.text(AttributedString(text[start..<text.endIndex]))) }
        self.segments = segments
    }
}

/// Parsed replies by their text, so scrolling back never parses again.
enum MarkdownCache {
    nonisolated(unsafe) private static let cache: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 400
        return cache
    }()

    private final class Box {
        let document: MarkdownDocument
        init(_ document: MarkdownDocument) { self.document = document }
    }

    static func document(for source: String) -> MarkdownDocument {
        let key = source as NSString
        if let hit = cache.object(forKey: key) { return hit.document }
        let document = MarkdownDocument(source)
        cache.setObject(Box(document), forKey: key)
        return document
    }
}
