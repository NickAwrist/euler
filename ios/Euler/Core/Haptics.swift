import QuartzCore
import SwiftUI
import UIKit

/// Haptics for events that come from code rather than a changing view value,
/// such as a notice or a turn finishing. Views reacting to their own state use
/// `.sensoryFeedback` instead.
enum Haptics {
    private static let notification = UINotificationFeedbackGenerator()
    private static let soft = UIImpactFeedbackGenerator(style: .soft)
    private static let rigid = UIImpactFeedbackGenerator(style: .rigid)
    private static let selection = UISelectionFeedbackGenerator()

    static func success() { notification.notificationOccurred(.success) }
    static func warning() { notification.notificationOccurred(.warning) }
    static func failure() { notification.notificationOccurred(.error) }

    /// A firm tap for a deliberate action such as Stop or Delete.
    static func firm() { rigid.impactOccurred(intensity: 0.8) }

    /// The tick of choosing something: a menu item, a row that acts, a form's
    /// button. The same as `.sensoryFeedback(.selection)`, for choices made in code.
    static func select() { selection.selectionChanged() }

    /// `action` with the tick before it, for a menu item, which no button style reaches.
    static func selecting(_ action: @escaping () -> Void) -> () -> Void {
        {
            select()
            action()
        }
    }

    /// A light tap for a small change such as sending or attaching an image.
    static func light() { soft.impactOccurred(intensity: 0.7) }

    private static var lastStreamTick: CFTimeInterval = 0

    /// A faint tick as a reply's text streams in. Text arrives many times a
    /// second, so ticks are spaced out into a steady patter.
    static func streaming() {
        let now = CACurrentMediaTime()
        guard now - lastStreamTick >= 0.085 else { return }
        lastStreamTick = now
        soft.impactOccurred(intensity: 0.45)
    }
}

extension Binding where Value: Sendable {
    /// The same binding, ticking when it is set: a choice made in a picker, as
    /// opposed to a value the page loaded.
    func ticking() -> Binding {
        Binding(
            get: { wrappedValue },
            set: { value in
                Haptics.select()
                wrappedValue = value
            }
        )
    }
}
