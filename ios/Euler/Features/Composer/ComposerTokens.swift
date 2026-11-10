import Foundation

/// The `$skill`, `@file` or `/tool` the caret is in, as the web's pickers find
/// them (ui/components/skillPicker.ts, filePicker.ts, composerSuggestions.ts).
struct ComposerToken: Equatable {
    enum Kind: Equatable {
        case skill
        case file
        case tool
        /// A whole message that is one `/command`, such as `/directory`.
        case command
    }

    let kind: Kind
    /// From the sigil through the end of the word the caret is in.
    let range: Range<String.Index>
    let query: String

    /// The token at `caret`, if any; skills win over files, files over tools.
    static func find(in text: String, caret: String.Index) -> ComposerToken? {
        skill(in: text, caret: caret) ?? file(in: text, caret: caret) ?? tool(in: text, caret: caret) ?? command(in: text)
    }

    static func skill(in text: String, caret: String.Index) -> ComposerToken? {
        guard let start = text[..<caret].lastIndex(of: "$") else { return nil }
        if start > text.startIndex, isWordCharacter(text[text.index(before: start)]) { return nil }
        let query = String(text[text.index(after: start)..<caret])
        guard query.allSatisfy({ $0.isLowercase || $0.isNumber || $0 == "-" }), query.allSatisfy(\.isASCII) else { return nil }
        let end = text[caret...].firstIndex { !($0.isLowercase || $0.isNumber || $0 == "-") } ?? text.endIndex
        return ComposerToken(kind: .skill, range: start..<end, query: query)
    }

    static func file(in text: String, caret: String.Index) -> ComposerToken? {
        guard caret > text.startIndex, let start = text[..<caret].lastIndex(of: "@") else { return nil }
        if start > text.startIndex, !"\n\t ([{".contains(text[text.index(before: start)]) { return nil }
        let afterSigil = text.index(after: start)
        let quoted = afterSigil < text.endIndex && text[afterSigil] == "\""
        let queryStart = quoted ? text.index(after: afterSigil) : afterSigil
        guard queryStart <= caret else { return nil }
        let query = String(text[queryStart..<caret])
        let stops: Set<Character> = quoted ? ["\"", "\r", "\n"] : [" ", "\n", "\t", "@", "\"", "<", ">", "(", ")", "[", "]", "{", "}"]
        guard !query.contains(where: stops.contains) else { return nil }
        var end = text[caret...].firstIndex(where: stops.contains) ?? text.endIndex
        if quoted, end < text.endIndex, text[end] == "\"" { end = text.index(after: end) }
        return ComposerToken(kind: .file, range: start..<end, query: query)
    }

    static func tool(in text: String, caret: String.Index) -> ComposerToken? {
        guard caret > text.startIndex, let start = text[..<caret].lastIndex(of: "/") else { return nil }
        if start > text.startIndex, !text[text.index(before: start)].isWhitespace { return nil }
        let query = String(text[text.index(after: start)..<caret])
        let allowed: (Character) -> Bool = { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }
        guard query.allSatisfy(allowed) else { return nil }
        let end = text[caret...].firstIndex { !allowed($0) } ?? text.endIndex
        return ComposerToken(kind: .tool, range: start..<end, query: query)
    }

    static func command(in text: String) -> ComposerToken? {
        let trimmed = text.drop { $0.isWhitespace }
        guard trimmed.hasPrefix("/"), !trimmed.contains(" "), !trimmed.contains("\n") else { return nil }
        return ComposerToken(kind: .command, range: trimmed.startIndex..<text.endIndex, query: String(trimmed.dropFirst()).lowercased())
    }

    /// Replaces the token with `replacement`, adding a space when it ends the text.
    /// Returns the new text and where the caret goes.
    func complete(_ text: String, with replacement: String) -> (text: String, caret: String.Index) {
        let spaced = range.upperBound == text.endIndex ? replacement + " " : replacement
        var result = text
        result.replaceSubrange(range, with: spaced)
        let caret = result.index(range.lowerBound, offsetBy: spaced.count)
        return (result, caret)
    }

    /// How a workspace path is written after `@`: quoted when it has spaces or brackets.
    static func fileReference(_ path: String) -> String {
        let needsQuotes = path.contains { " \"<>()[]{}@\t\n".contains($0) }
        guard needsQuotes else { return "@\(path)" }
        let escaped = path.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return "@\"\(escaped)\""
    }

    private static func isWordCharacter(_ character: Character) -> Bool {
        character.isASCII && (character.isLetter || character.isNumber || character == "_" || character == "-")
    }
}

/// The web's chat commands, offered when the whole message is a `/word`.
enum ChatCommand: String, CaseIterable {
    case directory
    case link
    case sandbox
    case workspace

    var description: String {
        switch self {
        case .directory: "Allow this chat to work in a folder on the server"
        case .link: "Work in another chat's workspace"
        case .sandbox: "Return this chat to its private workspace"
        case .workspace: "Show files in this chat's workspace"
        }
    }
}
