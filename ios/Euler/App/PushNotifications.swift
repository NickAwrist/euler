import EulerAPI
import Observation
import UIKit
import UserNotifications

/// Turn results and tool approvals while the app is closed. The server pushes
/// only when no event stream is open, which the app holds only in the foreground.
@Observable
final class PushNotifications: NSObject {
    private static let enabledKey = "EulerNotificationsEnabled"
    /// The server's category for approvals; keep in step with src/notifications/turnNotifier.ts.
    static let approvalCategory = "TOOL_APPROVAL"
    static let allowAction = "ALLOW_ONCE"
    static let denyAction = "DENY"

    /// The APNs device token, as hex, once the system hands it over.
    private(set) var token: String?
    /// The chat a tapped notification opens; the app clears it once shown.
    var openedSessionID: String?
    /// The user's choice in Settings, on until they turn it off. Off, the server forgets this device.
    private(set) var isEnabled = UserDefaults.standard.object(forKey: enabledKey) as? Bool ?? true
    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    /// Answers approvals from notification actions; set while signed in.
    @ObservationIgnored var backend: Backend?

    override init() {
        super.init()
        let allow = UNNotificationAction(identifier: Self.allowAction, title: "Allow once", options: [.authenticationRequired])
        let deny = UNNotificationAction(identifier: Self.denyAction, title: "Deny", options: [.destructive])
        UNUserNotificationCenter.current().setNotificationCategories([
            UNNotificationCategory(identifier: Self.approvalCategory, actions: [allow, deny], intentIdentifiers: []),
        ])
    }

    func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    /// Turns notifications on or off for this iPhone. On asks for permission if
    /// it was never asked; off tells the server to stop sending them.
    func setEnabled(_ enabled: Bool, backend: Backend) async {
        isEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: Self.enabledKey)
        if enabled {
            await requestAuthorization()
            await register(with: backend)
        } else if let token {
            var request = Euler_V1_UnregisterDeviceRequest()
            request.token = token
            _ = try? await backend.devices.unregisterDevice(request: request, headers: [:]).value()
        }
        await refreshAuthorization()
    }

    /// Asks for permission the first time, then registers for remote notifications.
    func requestAuthorization() async {
        guard isEnabled else { return }
        let center = UNUserNotificationCenter.current()
        switch await center.notificationSettings().authorizationStatus {
        case .notDetermined:
            guard (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) == true else { return }
        case .authorized, .provisional, .ephemeral:
            break
        default:
            return
        }
        UIApplication.shared.registerForRemoteNotifications()
    }

    func didRegister(token: Data) {
        self.token = token.map { String(format: "%02x", $0) }.joined()
    }

    /// Saves the token on the server for the signed-in user.
    func register(with backend: Backend) async {
        guard isEnabled, let token else { return }
        var request = Euler_V1_RegisterDeviceRequest()
        request.token = token
        request.bundleID = Bundle.main.bundleIdentifier ?? "net.spaceheater.euler"
        #if DEBUG
        request.environment = .sandbox
        #else
        request.environment = .production
        #endif
        _ = try? await backend.devices.registerDevice(request: request, headers: [:]).value()
    }

    /// Clears a chat's delivered notifications once it is on screen.
    func clearDelivered(sessionID: String) async {
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
        center.removeDeliveredNotifications(
            withIdentifiers: delivered.filter { $0.request.content.threadIdentifier == sessionID }.map(\.request.identifier)
        )
    }

    private func answer(_ decision: Euler_V1_ApprovalDecision, sessionID: String, approvalID: String) async {
        // An action can launch the app in the background, before any screen signs in.
        let saved = IdentityStore().identity.map { Backend(baseURL: $0.serverURL, userID: $0.userID) }
        guard let backend = backend ?? saved else { return }
        var request = Euler_V1_RespondToApprovalRequest()
        request.sessionID = sessionID
        request.approvalID = approvalID
        request.decision = decision
        _ = try? await backend.agent.respondToApproval(request: request, headers: [:]).value()
    }
}

extension PushNotifications: UNUserNotificationCenterDelegate {
    // These take completion handlers rather than the async forms: UIKit calls them
    // on the main thread and requires the handler there.

    /// The app shows turns itself while open, so a notification that arrives then stays silent.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([])
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let info = response.notification.request.content.userInfo
        let sessionID = info["sessionId"] as? String
        let approvalID = info["approvalId"] as? String
        let action = response.actionIdentifier
        // UIKit hands over the handler on the main thread and expects it back there.
        nonisolated(unsafe) let complete = completionHandler
        MainActor.assumeIsolated {
            if let sessionID, let approvalID, action == Self.allowAction || action == Self.denyAction {
                Task {
                    await answer(action == Self.allowAction ? .allowOnce : .deny, sessionID: sessionID, approvalID: approvalID)
                    complete()
                }
                return
            }
            if let sessionID { openedSessionID = sessionID }
            complete()
        }
    }
}

/// Hands the system's push callbacks to `PushNotifications`.
final class AppDelegate: NSObject, UIApplicationDelegate {
    let push = PushNotifications()

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = push
        Typography.registerBundledFonts()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        push.didRegister(token: deviceToken)
    }
}
