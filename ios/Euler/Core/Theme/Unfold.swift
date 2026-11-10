import SwiftUI

/// Reports a share of its content's height. A row that jumped in at full height
/// would move everything around it in one frame; growing lets it move gradually.
struct Unfold: Layout {
    var progress: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard let content = subviews.first else { return .zero }
        let size = content.sizeThatFits(proposal)
        return CGSize(width: size.width, height: size.height * progress)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: nil))
    }
}

private struct UnfoldModifier: ViewModifier {
    let progress: CGFloat
    /// Whether the part that hasn't unfolded yet is hidden rather than drawn over what follows.
    var clips = false

    func body(content: Content) -> some View {
        if clips {
            Unfold(progress: progress) { content }.clipped().opacity(progress)
        } else {
            Unfold(progress: progress) { content }.opacity(progress)
        }
    }
}

extension AnyTransition {
    /// Grows a row to its height as it fades in. One removed just goes.
    static let unfold = AnyTransition.asymmetric(
        insertion: .modifier(active: UnfoldModifier(progress: 0), identity: UnfoldModifier(progress: 1)),
        removal: .identity
    )

    /// Opens downward from its top edge, uncovering its content as it goes, and
    /// closes back up into it.
    static let reveal = AnyTransition.modifier(
        active: UnfoldModifier(progress: 0, clips: true),
        identity: UnfoldModifier(progress: 1, clips: true)
    )
}
