import Foundation
import Observation

/// Where the app connects and which user it acts as. The user ID is the web
/// app's `euler:userUuid`: a trusted-tailnet convenience, not a credential.
struct Identity: Hashable, Sendable {
    var serverURL: URL
    var userID: String

    /// The server's pattern: an RFC 4122 UUID, versions 1 to 5.
    static func isValidUserID(_ value: String) -> Bool {
        value.wholeMatch(of: /(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/) != nil
    }

    /// The server's address, normalized to its origin. Without a scheme it is taken as `http`.
    static func serverURL(from text: String) -> URL? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let withScheme = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard var components = URLComponents(string: withScheme),
              components.scheme == "https" || components.scheme == "http",
              components.host?.isEmpty == false
        else { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }
}

/// Persists the identity: the user ID in the Keychain, the server address in defaults.
@Observable
final class IdentityStore {
    private static let userIDAccount = "user-id"
    private static let serverURLKey = "EulerServerURL"
    /// A launch argument (`-EulerResetIdentity YES`) UI tests pass to start from onboarding.
    private static let resetKey = "EulerResetIdentity"

    private(set) var identity: Identity?

    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if defaults.bool(forKey: Self.resetKey) {
            Keychain.set(nil, for: Self.userIDAccount)
            defaults.removeObject(forKey: Self.serverURLKey)
            return
        }
        if let userID = Keychain.string(for: Self.userIDAccount), Identity.isValidUserID(userID),
           let server = savedServerURL {
            identity = Identity(serverURL: server, userID: userID.lowercased())
        }
    }

    private var savedServerURL: URL? {
        defaults.string(forKey: Self.serverURLKey).flatMap(Identity.serverURL(from:))
    }

    /// The saved server address, if one was ever saved.
    var serverURL: URL? {
        identity?.serverURL ?? savedServerURL
    }

    func save(_ identity: Identity) {
        Keychain.set(identity.userID, for: Self.userIDAccount)
        defaults.set(identity.serverURL.absoluteString, forKey: Self.serverURLKey)
        SharedSettings.setServerURL(identity.serverURL)
        self.identity = identity
    }

    /// Forgets the user, keeping the address so onboarding offers it again.
    func signOut() {
        Keychain.set(nil, for: Self.userIDAccount)
        identity = nil
    }
}

/// Values the notification service extension reads through the shared app group.
enum SharedSettings {
    /// Keep in step with `NotificationService`.
    static let suiteName = "group.net.spaceheater.euler"
    static let serverURLKey = "EulerServerURL"

    static func setServerURL(_ url: URL) {
        UserDefaults(suiteName: suiteName)?.set(url.absoluteString, forKey: serverURLKey)
    }
}
