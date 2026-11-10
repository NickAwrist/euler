import HighlightSwift
import SwiftUI

/// A fenced code block: language and Copy above, highlighted code that scrolls sideways.
struct CodeBlockView: View {
    let code: String
    let language: String?
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography
    @State private var highlighted: AttributedString?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(language ?? "Code")
                    .font(.caption)
                    .foregroundStyle(palette.muted)
                Spacer()
                CopyButton(text: code, label: "Copy code")
            }
            .padding(.leading, 12)
            .padding(.trailing, 4)
            .frame(height: 32)
            .background(palette.surface)
            Divider().overlay(palette.borderSubtle)
            ScrollView(.horizontal, showsIndicators: false) {
                Text(highlighted ?? AttributedString(code))
                    .font(typography.code(size: 13.5))
                    .foregroundStyle(palette.foreground)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(12)
            }
        }
        .background(palette.background.opacity(0.6))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette.borderSubtle, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .task(id: "\(palette.code.rawValue)|\(language ?? "")|\(code)") {
            highlighted = await CodeHighlighter.highlight(code, language: language, theme: palette.code)
        }
    }
}

/// Copies text, showing a check for a moment once it has.
struct CopyButton: View {
    let text: String
    var label = "Copy"
    @Environment(\.palette) private var palette
    @State private var copied = false

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied = true
        } label: {
            Label(copied ? "Copied" : label, systemImage: copied ? "checkmark" : "doc.on.doc")
                .labelStyle(.iconOnly)
                .font(.caption)
                .foregroundStyle(palette.muted)
                .frame(width: 32, height: 28)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.success, trigger: copied) { _, new in new }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}

/// highlight.js through HighlightSwift, cached per block and theme.
enum CodeHighlighter {
    private static let highlight = Highlight()
    nonisolated(unsafe) private static var cache: [String: AttributedString] = [:]

    static func highlight(_ code: String, language: String?, theme: HighlightTheme) async -> AttributedString? {
        let key = "\(theme.rawValue)|\(language ?? "")|\(code)"
        if let hit = cache[key] { return hit }
        // Long blocks stay plain; highlighting them costs more than it gives on a phone.
        guard code.count < 20_000 else { return nil }
        let colors = HighlightColors.dark(theme)
        var result: AttributedString?
        if let language, !language.isEmpty {
            result = try? await highlight.attributedText(code, language: language, colors: colors)
        }
        if result == nil {
            result = try? await highlight.attributedText(code, colors: colors)
        }
        guard var result else { return nil }
        // The block sets its own font and background.
        result.font = nil
        result.backgroundColor = nil
        if cache.count > 300 { cache.removeAll() }
        cache[key] = result
        return result
    }
}
