import UIKit

/// Haptics for events that come from code rather than a changing view value,
/// such as a notice or a turn finishing. Views reacting to their own state use
/// `.sensoryFeedback` instead.
enum Haptics {
    private static let notification = UINotificationFeedbackGenerator()
    private static let soft = UIImpactFeedbackGenerator(style: .soft)
    private static let rigid = UIImpactFeedbackGenerator(style: .rigid)

    static func success() { notification.notificationOccurred(.success) }
    static func warning() { notification.notificationOccurred(.warning) }
    static func failure() { notification.notificationOccurred(.error) }

    /// A firm tap for a deliberate action such as Stop or Delete.
    static func firm() { rigid.impactOccurred(intensity: 0.8) }

    /// A light tap for a small change such as sending or attaching an image.
    static func light() { soft.impactOccurred(intensity: 0.7) }
}
