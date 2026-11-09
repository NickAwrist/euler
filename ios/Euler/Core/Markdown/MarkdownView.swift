import SwiftUI

/// A reply's Markdown as native views: text, lists, quotes, tables, code and math.
struct MarkdownView: View {
    let source: String

    var body: some View {
        MarkdownBlocks(blocks: MarkdownCache.document(for: source).blocks)
    }
}

private struct MarkdownBlocks: View {
    let blocks: [MarkdownBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(blocks.indices, id: \.self) { index in
                MarkdownBlockView(block: blocks[index])
            }
        }
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography

    var body: some View {
        switch block {
        case .paragraph(let inline):
            InlineText(inline: inline, font: typography.body(), size: 16)
                .fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let inline):
            InlineText(inline: inline, font: typography.body(size: headingSize(level), relativeTo: .title3).weight(.semibold), size: headingSize(level))
                .padding(.top, level <= 2 ? 6 : 2)
        case .list(let ordered, let start, let items):
            VStack(alignment: .leading, spacing: 6) {
                ForEach(items.indices, id: \.self) { index in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        marker(ordered: ordered, number: start + index, checkbox: items[index].checkbox)
                        MarkdownBlocks(blocks: items[index].blocks)
                    }
                }
            }
            .padding(.leading, 4)
        case .quote(let blocks):
            MarkdownBlocks(blocks: blocks)
                .foregroundStyle(palette.muted)
                .padding(.leading, 12)
                .overlay(alignment: .leading) {
                    Rectangle().fill(palette.border).frame(width: 3)
                }
        case .code(let language, let code):
            CodeBlockView(code: code, language: language)
        case .math(let tex):
            DisplayMath(tex: tex)
        case .table(let table):
            TableView(table: table)
        case .image(let url, let alt):
            MarkdownImage(path: url, alt: alt)
        case .rule:
            Rectangle().fill(palette.borderSubtle).frame(height: 1).padding(.vertical, 4)
        }
    }

    private func headingSize(_ level: Int) -> CGFloat {
        switch level {
        case 1: 24
        case 2: 21
        case 3: 19
        default: 17
        }
    }

    @ViewBuilder
    private func marker(ordered: Bool, number: Int, checkbox: Bool?) -> some View {
        if let checked = checkbox {
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .foregroundStyle(palette.muted)
                .accessibilityLabel(checked ? "Done" : "Not done")
        } else if ordered {
            Text("\(number).").font(typography.body()).monospacedDigit().foregroundStyle(palette.muted)
        } else {
            Text("•").font(typography.body()).foregroundStyle(palette.muted)
        }
    }
}

/// Inline Markdown as one `Text`, with math typeset in line.
struct InlineText: View {
    let inline: MarkdownInline
    let font: Font
    let size: CGFloat
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography

    var body: some View {
        text
            .font(font)
            .foregroundStyle(palette.foreground)
            .tint(palette.accent)
            .lineSpacing(4)
    }

    private var text: Text {
        let scaled = UIFontMetrics.default.scaledValue(for: size)
        return inline.segments.reduce(Text(verbatim: "")) { partial, segment in
            switch segment {
            case .text(let attributed):
                return Text("\(partial)\(Text(styled(attributed)))")
            case .math(let tex):
                if let rendered = MathRenderer.render(tex, display: false, fontSize: scaled, color: UIColor(palette.foreground)) {
                    let image = Text(Image(uiImage: rendered.image).renderingMode(.original))
                        .baselineOffset(-rendered.descent)
                    return Text("\(partial)\(image)")
                }
                return Text("\(partial)\(Text(verbatim: tex).font(typography.code(size: size * 0.85)))")
            }
        }
    }

    /// Code, links and emphasis in the theme's colors and fonts.
    private func styled(_ source: AttributedString) -> AttributedString {
        var text = source
        for run in text.runs {
            guard let intent = run.inlinePresentationIntent else { continue }
            if intent.contains(.code) {
                text[run.range].font = typography.code(size: size * 0.85)
                text[run.range].backgroundColor = palette.surface
            }
            if intent.contains(.stronglyEmphasized) {
                text[run.range].font = (intent.contains(.code) ? typography.code(size: size * 0.85) : font).bold()
            }
            if intent.contains(.emphasized), !intent.contains(.code) {
                text[run.range].font = (intent.contains(.stronglyEmphasized) ? font.bold() : font).italic()
            }
            if intent.contains(.strikethrough) {
                text[run.range].strikethroughStyle = .single
            }
        }
        for run in text.runs where run.link != nil {
            text[run.range].foregroundColor = palette.accent
            text[run.range].underlineStyle = .single
        }
        return text
    }
}

/// A display equation, scrolling sideways when wider than the screen.
private struct DisplayMath: View {
    let tex: String
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography

    var body: some View {
        let size = UIFontMetrics.default.scaledValue(for: 19)
        if let rendered = MathRenderer.render(tex, display: true, fontSize: size, color: UIColor(palette.foreground)) {
            let image = Image(uiImage: rendered.image).accessibilityLabel(tex)
            // Centered like KaTeX's display math; wider formulas scroll sideways.
            ViewThatFits(in: .horizontal) {
                image.frame(maxWidth: .infinity)
                ScrollView(.horizontal, showsIndicators: false) { image }
            }
        } else {
            // Formulas SwiftMath can't typeset show their source, as the web shows invalid TeX.
            ScrollView(.horizontal, showsIndicators: false) {
                Text(verbatim: tex)
                    .font(typography.code())
                    .foregroundStyle(palette.muted)
                    .textSelection(.enabled)
            }
        }
    }
}

private struct TableView: View {
    let table: MarkdownTable
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography

    var body: some View {
        let widths = columnWidths
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(table.head.indices, id: \.self) { column in
                        cell(table.head[column], column: column, width: widths[column], header: true)
                    }
                }
                ForEach(table.rows.indices, id: \.self) { row in
                    Divider().overlay(palette.borderSubtle)
                    GridRow {
                        ForEach(table.rows[row].indices, id: \.self) { column in
                            cell(table.rows[row][column], column: column, width: widths.indices.contains(column) ? widths[column] : 120, header: false)
                        }
                    }
                }
            }
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(palette.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    /// Each column's width from its longest cell, so text wraps the same way when the
    /// grid measures a row and when it draws it. Wrapping at a width the grid
    /// chose itself let tall rows overlap.
    private var columnWidths: [CGFloat] {
        table.head.indices.map { column in
            let longest = ([table.head[column]] + table.rows.compactMap { $0.indices.contains(column) ? $0[column] : nil }).map(\.length).max() ?? 0
            return min(260, max(64, CGFloat(longest) * 8.2)) + 20
        }
    }

    private func cell(_ inline: MarkdownInline, column: Int, width: CGFloat, header: Bool) -> some View {
        let alignment: Alignment = switch table.alignments.indices.contains(column) ? table.alignments[column] : nil {
        case .center: .center
        case .right: .trailing
        default: .leading
        }
        return InlineText(inline: inline, font: header ? typography.body(size: 15).weight(.semibold) : typography.body(size: 15), size: 15)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(width: width, alignment: alignment)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxHeight: .infinity, alignment: .top)
            .background(header ? palette.surface : .clear)
    }
}

/// An image a reply embeds, such as a ComfyUI output loaded by its server path.
private struct MarkdownImage: View {
    let path: String
    let alt: String
    @Environment(AppSession.self) private var session

    var body: some View {
        if let url = session.backend.url(forPath: path) {
            RemoteImage(url: url, alt: alt.isEmpty ? "Generated image" : alt)
                .frame(maxWidth: 320, maxHeight: 320, alignment: .leading)
        }
    }
}
