import EulerAPI
import SwiftUI

/// The app's frame: a new chat or an open chat, with the chat list in a drawer
/// that slides in from the leading edge, as the web's sidebar does.
struct HomeView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var screen = Screen.newChat(UUID(), ephemeral: false)
    @State private var drawerOpen = false
    /// The drawer's travel while a finger drags it, in points from where it rests.
    @State private var drag: CGFloat = 0
    /// Whether the drawer is still sliding shut, which keeps it on screen until it has.
    @State private var closing = false

    enum Screen: Hashable {
        /// Each new chat has its own identity, so starting another resets the draft.
        case newChat(UUID, ephemeral: Bool)
        case chat(String)

        var chatID: String? {
            if case .chat(let id) = self { id } else { nil }
        }
    }

    var body: some View {
        GeometryReader { geometry in
            let width = min(geometry.size.width * 0.84, 340)
            let progress = min(1, max(0, (drawerOpen ? width : 0) + drag) / width)
            ZStack(alignment: .leading) {
                // Built only while showing, so a closed drawer isn't in the accessibility tree.
                // It stays until it has slid shut: removed any sooner, it would fade where it
                // stood rather than move with the animation.
                if progress > 0 || closing {
                    ChatDrawer(current: screen.chatID, open: show, newChat: newChat) { id in
                        if screen.chatID == id { newChat(ephemeral: false) }
                    }
                    .frame(width: width)
                    .offset(x: (progress - 1) * width * 0.3)
                    .opacity(0.4 + 0.6 * progress)
                    .allowsHitTesting(drawerOpen)
                    .accessibilityAddTraits(.isModal)
                    .accessibilityAction(.escape) { settle(open: false) }
                    .transition(.asymmetric(insertion: .opacity, removal: .identity))
                }
                NavigationStack {
                    content
                        .id(screen)
                        .transition(.opacity)
                        .toolbar { toolbar }
                }
                // Full screen, so the content runs under the bars.
                .ignoresSafeArea(.container)
                .accessibilityHidden(drawerOpen)
                // A drag that starts at the leading edge pulls the drawer out; it runs
                // beside the content's own gestures, so scrolling and taps are unaffected.
                .simultaneousGesture(DragGesture(minimumDistance: 12, coordinateSpace: .global)
                    .onChanged { value in
                        guard !drawerOpen, value.startLocation.x < 24,
                              abs(value.translation.width) > abs(value.translation.height) else { return }
                        if drag == 0 { dismissKeyboard() }
                        drag = max(0, value.translation.width)
                    }
                    .onEnded { value in
                        guard !drawerOpen, drag > 0 else { return }
                        settle(open: value.translation.width > width / 3 || value.predictedEndTranslation.width > width / 2)
                    })
                .overlay {
                    // Always present, for the same reason: it dims by its opacity alone.
                    Color.black.opacity(0.4 * progress)
                        .ignoresSafeArea()
                        .contentShape(.rect)
                        .onTapGesture { settle(open: false) }
                        // Measured on the screen: the dimmed content moves with the drag, so its
                        // own coordinates would chase the finger and flicker.
                        .gesture(DragGesture(minimumDistance: 8, coordinateSpace: .global)
                            .onChanged { value in drag = min(0, value.translation.width) }
                            .onEnded { value in
                                settle(open: value.translation.width > -width / 3 && value.predictedEndTranslation.width > -width / 2)
                            })
                        .allowsHitTesting(progress > 0)
                        .accessibilityHidden(!drawerOpen)
                        .accessibilityLabel("Close chats")
                        .accessibilityAddTraits(.isButton)
                }
                // A mask that covers the whole screen: a clip would follow this view's frame,
                // which stops at the safe area and cut off the content under the home indicator.
                .mask { RoundedRectangle(cornerRadius: progress > 0 ? 28 : 0).ignoresSafeArea() }
                .offset(x: progress * width)
            }
        }
        .background(palette.background)
        .environment(\.openSettings) { page in session.settingsPage = page }
        .sheet(item: Binding(get: { session.settingsPage }, set: { session.settingsPage = $0 })) { page in
            SettingsView(page: page)
        }
        .onChange(of: session.route, initial: true) { _, route in
            guard case .chat(let id) = route else { return }
            session.settingsPage = nil
            show(id)
            session.route = nil
        }
        .onChange(of: session.settingsPage) { _, page in
            if page != nil { settle(open: false) }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: drawerOpen)
    }

    @ViewBuilder
    private var content: some View {
        switch screen {
        case .newChat(_, let ephemeral):
            NewChatView(ephemeral: ephemeral, open: show)
        case .chat(let id):
            ChatView(chat: session.chat(id))
        }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button { settle(open: true) } label: {
                Image(systemName: "sidebar.left")
                    .overlay(alignment: .topTrailing) {
                        if hasNews {
                            Circle().fill(palette.tint).frame(width: 7, height: 7).offset(x: 4, y: -3)
                        }
                    }
            }
            .accessibilityLabel(hasNews ? "Chats, new replies" : "Chats")
        }
        if screen.chatID != nil {
            ToolbarItem(placement: .topBarTrailing) {
                Button("New chat", systemImage: "square.and.pencil", action: Haptics.selecting { newChat(ephemeral: false) })
            }
        }
    }

    /// Another chat has an unread reply.
    private var hasNews: Bool {
        session.sessions.sessions.contains { $0.badge == .unread && $0.id != screen.chatID }
    }

    private func show(_ id: String) {
        if screen != .chat(id) { go(to: .chat(id)) }
        settle(open: false)
    }

    private func newChat(ephemeral: Bool) {
        go(to: .newChat(UUID(), ephemeral: ephemeral))
        settle(open: false)
    }

    /// Screens trade places in a short fade rather than a cut.
    private func go(to next: Screen) {
        withAnimation(.easeInOut(duration: 0.22)) { screen = next }
    }

    private func settle(open: Bool) {
        if open { dismissKeyboard() }
        closing = !open && (drawerOpen || drag > 0)
        withAnimation(.spring(response: 0.35, dampingFraction: 0.86)) {
            drawerOpen = open
            drag = 0
        } completion: {
            closing = false
        }
    }
}

/// Puts the keyboard away, wherever it is.
@MainActor
func dismissKeyboard() {
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
}
