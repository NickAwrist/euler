import SwiftUI

/// Onboarding until an identity is saved, then the signed-in app for that identity.
struct RootView: View {
    @Environment(IdentityStore.self) private var identityStore

    var body: some View {
        if let identity = identityStore.identity {
            SignedInView(identity: identity)
                .id(identity)
        } else {
            OnboardingView()
        }
    }
}

/// Owns the session for one identity and ties its event stream to the foreground.
private struct SignedInView: View {
    @State private var session: AppSession
    @Environment(\.scenePhase) private var scenePhase
    @Environment(PushNotifications.self) private var push

    init(identity: Identity) {
        _session = State(initialValue: AppSession(identity: identity))
    }

    var body: some View {
        let appearance = session.preferences.appearance
        ChatListView()
            .environment(session)
            .environment(\.palette, Palette(appearance.theme))
            .environment(\.typography, Typography(font: appearance.font, codeFont: appearance.codeFont))
            .tint(Palette(appearance.theme).accent)
            .task {
                push.backend = session.backend
                async let preferences: Void = session.preferences.load()
                async let models: Void = session.models.load()
                async let chats: Void = session.sessions.reload()
                _ = await (preferences, models, chats)
                await push.requestAuthorization()
            }
            // Each identity registers this device for its own user.
            .task(id: push.token) { await push.register(with: session.backend) }
            .onChange(of: scenePhase, initial: true) { _, phase in
                // The server skips push for users with an open stream, so it closes in the background.
                if phase == .active {
                    session.events.start()
                } else if phase == .background {
                    session.events.stop()
                }
            }
            .onChange(of: push.openedSessionID, initial: true) { _, id in
                guard let id else { return }
                session.route = .chat(id)
                push.openedSessionID = nil
            }
    }
}
