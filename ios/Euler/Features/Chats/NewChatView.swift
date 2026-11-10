import EulerAPI
import SwiftUI

/// A chat that exists once its first message is sent: the web's welcome
/// screen, with the composer centered between a greeting and recent chats.
struct NewChatView: View {
    let open: (String) -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography
    @State private var draft = ComposerDraft()
    @State private var ephemeral: Bool
    @State private var sheet: ChatSheet?
    @FocusState private var typing: Bool
    @State private var greeting: WelcomeGreeting?
    /// How far the keyboard covers this screen, and where the screen ends on the display.
    @State private var keyboard: CGFloat = 0
    @State private var bottom: CGFloat = 0

    init(ephemeral: Bool, open: @escaping (String) -> Void) {
        _ephemeral = State(initialValue: ephemeral)
        self.open = open
    }

    var body: some View {
        VStack(spacing: 0) {
            header
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, 28)
                .contentShape(.rect)
                .onTapGesture { typing = false }
            ComposerView(
                target: .new(draft, ephemeral: ephemeral, start: open),
                sheet: $sheet,
                focused: $typing
            )
            .padding(.horizontal, 12)
            .padding(.bottom, keyboard > 0 ? 6 : 0)
            if keyboard == 0 {
                below
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                    .transition(.opacity)
            }
        }
        .padding(.bottom, keyboard)
        // Measured inside the keyboard's safe area, so the keyboard doesn't change it.
        .onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { bottom = $0 }
        // The recent chats leaving and the keyboard arriving move the composer in
        // opposite directions, so both follow the keyboard's frame in one animation
        // on its curve rather than the system's avoidance, which arrives separately.
        .ignoresSafeArea(.keyboard)
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
            guard let frame = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
            withAnimation(.interpolatingSpring(mass: 3, stiffness: 1000, damping: 500)) {
                keyboard = max(0, bottom - frame.minY)
            }
        }
        .background(palette.background)
        .navigationTitle(ephemeral ? "Ephemeral chat" : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                // An amber glyph rather than the button style's solid fill, which outshone the screen.
                Button { withAnimation { ephemeral.toggle() } } label: {
                    Image(systemName: ephemeral ? "eye.slash.fill" : "eye.slash")
                        .foregroundStyle(ephemeral ? Palette.ephemeral : palette.muted)
                        .contentTransition(.symbolEffect(.replace))
                }
                .accessibilityLabel("Ephemeral")
                .accessibilityValue(ephemeral ? "On" : "Off")
                .accessibilityHint("Deleted after it expires")
            }
        }
        .sensoryFeedback(.selection, trigger: ephemeral)
        .onAppear {
            if greeting == nil { greeting = .next() }
            greeting?.name = WelcomeGreeting.firstName(session.preferences.settings.name)
        }
    }

    private var header: some View {
        VStack(spacing: 0) {
            let color = ephemeral ? Palette.ephemeral : palette.mark
            Image(systemName: ephemeral ? "eye.slash" : "sparkles")
                .font(.system(size: 19, weight: .medium))
                .foregroundStyle(color)
                .frame(width: 44, height: 44)
                .background(color.opacity(0.1), in: .rect(cornerRadius: 12))
                .contentTransition(.symbolEffect(.replace))
                .padding(.bottom, 16)
            greetingText
                .font(typography.body(size: 30, relativeTo: .largeTitle))
                .tracking(-0.6)
                .lineSpacing(2)
                .multilineTextAlignment(.center)
                .foregroundStyle(palette.foreground)
                .minimumScaleFactor(0.7)
                .padding(.bottom, 14)
            // Both lines keep their space, so switching modes leaves the mark and greeting in place.
            ZStack(alignment: .top) {
                subtitle("Type / for commands or $ to use a skill.", font: .caption, shown: !ephemeral)
                subtitle("This chat, its messages, and its files are deleted when it expires.", font: .subheadline, shown: ephemeral)
            }
            .foregroundStyle(palette.muted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 300)
        }
        .padding(.horizontal, 24)
    }

    private func subtitle(_ text: String, font: Font, shown: Bool) -> some View {
        Text(text)
            .font(font)
            .opacity(shown ? 1 : 0)
            .accessibilityHidden(!shown)
    }

    private var greetingText: Text {
        let question = greeting?.question ?? WelcomeGreeting.questions[0]
        if let name = greeting?.name, greeting?.personalized == true {
            return Text("\(String(question.dropLast())), \(Text(name).italic())?")
        }
        return Text(question)
    }

    /// The five most recent chats, as on the web's home.
    @ViewBuilder
    private var below: some View {
        let recent = session.sessions.sessions.prefix(5)
        ScrollView {
            VStack(spacing: 22) {
                if !recent.isEmpty {
                    VStack(spacing: 6) {
                        Text("Recent")
                            .font(.caption2.weight(.semibold))
                            .textCase(.uppercase)
                            .tracking(1.2)
                            .foregroundStyle(palette.muted)
                            .padding(.top, 10)
                            .padding(.bottom, 4)
                        ForEach(Array(recent), id: \.id) { summary in
                            Button { open(summary.id) } label: {
                                HStack(spacing: 12) {
                                    Text(summary.title.isEmpty ? "Chat" : summary.title)
                                        .font(.footnote.weight(.medium))
                                        .foregroundStyle(palette.foreground)
                                        .lineLimit(1)
                                    Spacer(minLength: 0)
                                    Text(Format.sessionTime(summary.updatedAt.date))
                                        .font(.caption)
                                        .foregroundStyle(palette.muted)
                                }
                                .padding(.horizontal, 12)
                                .padding(.vertical, 11)
                                .background(palette.surface, in: .rect(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette.borderSubtle))
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .overlay(alignment: .top) { Rectangle().fill(palette.borderSubtle).frame(height: 1) }
                    // An ephemeral chat hides them where they stand, so they fade rather than
                    // fold away with the space they took.
                    .opacity(ephemeral ? 0 : 1)
                    .allowsHitTesting(!ephemeral)
                    .accessibilityHidden(ephemeral)
                }
            }
            .padding(.horizontal, 24)
            .padding(.top, 22)
            .padding(.bottom, 16)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}

/// The web's rotating welcome question (ui/components/welcomeQuestions.ts):
/// the preferred default first, then a different one each time, sometimes with
/// the user's first name.
struct WelcomeGreeting {
    static let questions = [
        "What are we working on today?",
        "What's on your mind?",
        "Where should we start?",
        "What would you like to figure out?",
        "What would you like a hand with?",
        "What would you like to explore?",
    ]
    /// The previous question this launch; the web keeps it per tab.
    @MainActor private static var previous: String?

    let question: String
    let personalized: Bool
    /// The user's first name, shown in a personalized question.
    var name: String?

    @MainActor
    static func next() -> WelcomeGreeting {
        let greeting: WelcomeGreeting
        if let last = previous {
            let personalized = Double.random(in: 0..<1) < 0.25
            let pool = (personalized ? Array(questions[1..<4]) : questions).filter { $0 != last }
            greeting = WelcomeGreeting(question: pool.randomElement() ?? questions[0], personalized: personalized)
        } else {
            greeting = WelcomeGreeting(question: questions[0], personalized: false)
        }
        previous = greeting.question
        return greeting
    }

    static func firstName(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.contains("@") else { return nil }
        return trimmed.split(whereSeparator: \.isWhitespace).first.map(String.init)
    }
}
