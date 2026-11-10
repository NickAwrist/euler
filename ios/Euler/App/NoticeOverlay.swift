import SwiftUI
import UIKit

/// The session's notices in a window above the app's own, so a notice raised
/// from a sheet shows over the sheet rather than behind it.
@MainActor
final class NoticeOverlay {
    private var window: PassthroughWindow?

    func show(for session: AppSession) {
        guard window == nil, let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        let window = PassthroughWindow(windowScene: scene)
        let host = UIHostingController(rootView: NoticeLayer(session: session) { [weak window] frame in
            window?.bannerFrame = frame
        })
        host.view.backgroundColor = .clear
        window.isShowingBanner = { [weak session] in session?.notices.current != nil }
        window.rootViewController = host
        window.windowLevel = .normal + 1
        window.overrideUserInterfaceStyle = .dark
        window.isHidden = false
        self.window = window
    }

    func hide() {
        window?.isHidden = true
        window = nil
    }
}

/// Takes touches on the banner only; the rest reach the app underneath.
private final class PassthroughWindow: UIWindow {
    var bannerFrame = CGRect.zero
    var isShowingBanner: () -> Bool = { false }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        isShowingBanner() && bannerFrame.contains(point) ? super.hitTest(point, with: event) : nil
    }
}

private struct NoticeLayer: View {
    let session: AppSession
    let located: (CGRect) -> Void

    var body: some View {
        NoticeBanner(located: located)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .environment(session)
            .environment(\.palette, Palette(session.preferences.appearance.theme))
    }
}

/// The current notice, floating over the screen until it times out or is tapped.
private struct NoticeBanner: View {
    /// Reports where the banner is on screen, for the window's hit testing.
    let located: (CGRect) -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette

    var body: some View {
        ZStack {
            if let notice = session.notices.current {
                Button { session.notices.dismiss() } label: {
                    Label(notice.message, systemImage: notice.tone == .failure ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(palette.foreground)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .glassEffect()
                }
                .buttonStyle(.plain)
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { located($0) }
                .padding(.top, 8)
                .padding(.horizontal, 16)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.snappy, value: session.notices.current)
    }
}
