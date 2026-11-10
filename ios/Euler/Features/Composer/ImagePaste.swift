import ObjectiveC
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Lets the text field it sits behind take pasted images. SwiftUI's field
/// pastes text only and has no hook for more, so this finds the UITextView that
/// backs the field and gives that one view a subclass, made at run time as
/// key-value observing makes them, that offers Paste for an image and hands it
/// over. Text pastes as before.
struct ImagePasteTarget: UIViewRepresentable {
    let paste: (Data, UTType) -> Void

    func makeUIView(context: Context) -> Probe {
        let probe = Probe()
        probe.isUserInteractionEnabled = false
        return probe
    }

    func updateUIView(_ probe: Probe, context: Context) {
        probe.taker.take = paste
        probe.attach()
    }

    /// Sits where the field is drawn and finds the text view drawn over it.
    final class Probe: UIView {
        fileprivate let taker = ImageTaker()
        private weak var field: UITextView?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            // The field's own view may join the window a moment after this one.
            Task { attach() }
        }

        override func layoutSubviews() {
            super.layoutSubviews()
            attach()
        }

        func attach() {
            guard window != nil, field?.window == nil else { return }
            let frame = convert(bounds, to: nil)
            var ancestor = superview
            while let view = ancestor {
                // SwiftUI keeps its UIKit views shallow, so the nearest ancestor with a text
                // view may hold several; the field is the one over this view.
                if let field = view.descendants(UITextView.self).first(where: { $0.convert($0.bounds, to: nil).intersects(frame) }) {
                    ImagePasting.adopt(field, taker: taker)
                    self.field = field
                    return
                }
                ancestor = view.superview
            }
        }
    }
}

/// Where a text view's pasted images go.
private final class ImageTaker {
    var take: (Data, UTType) -> Void = { _, _ in }
}

private enum ImagePasting {
    private static var takerKey: UInt8 = 0
    private static let pasteAction = #selector(UIResponderStandardEditActions.paste(_:))
    private static let canPerform = #selector(UIResponder.canPerformAction(_:withSender:))
    /// The formats the server stores as they are; any other image is re-encoded.
    private static let stored: [UTType] = [.png, .jpeg, .gif, .webP]

    static func adopt(_ field: UITextView, taker: ImageTaker) {
        objc_setAssociatedObject(field, &takerKey, taker, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        guard let base = object_getClass(field) else { return }
        let name = "EulerImagePasting_\(NSStringFromClass(base))"
        if NSStringFromClass(base).hasPrefix("EulerImagePasting_") { return }
        guard let subclass = NSClassFromString(name) ?? make(name, from: base) else { return }
        object_setClass(field, subclass)
    }

    /// Whether Paste on `field` means an image for its taker: one is on the
    /// clipboard and no text is, which the field would paste itself.
    private static func taker(for field: UITextView) -> ImageTaker? {
        guard UIPasteboard.general.hasImages, !UIPasteboard.general.hasStrings else { return nil }
        return objc_getAssociatedObject(field, &takerKey) as? ImageTaker
    }

    private static func make(_ name: String, from base: AnyClass) -> AnyClass? {
        guard let subclass = objc_allocateClassPair(base, name, 0),
              let canPerformMethod = class_getInstanceMethod(base, canPerform),
              let pasteMethod = class_getInstanceMethod(base, pasteAction)
        else { return nil }
        typealias CanPerform = @convention(c) (UITextView, Selector, Selector, Any?) -> Bool
        typealias Paste = @convention(c) (UITextView, Selector, Any?) -> Void
        let superCanPerform = unsafeBitCast(method_getImplementation(canPerformMethod), to: CanPerform.self)
        let superPaste = unsafeBitCast(method_getImplementation(pasteMethod), to: Paste.self)

        let canPerformBlock: @convention(block) (UITextView, Selector, Any?) -> Bool = { field, action, sender in
            if action == pasteAction, taker(for: field) != nil { return true }
            return superCanPerform(field, canPerform, action, sender)
        }
        let pasteBlock: @convention(block) (UITextView, Any?) -> Void = { field, sender in
            guard let taker = taker(for: field) else { return superPaste(field, pasteAction, sender) }
            let board = UIPasteboard.general
            for type in stored {
                if let data = board.data(forPasteboardType: type.identifier) { return taker.take(data, type) }
            }
            if let data = board.image?.pngData() { taker.take(data, .png) }
        }
        class_addMethod(subclass, canPerform, imp_implementationWithBlock(canPerformBlock), method_getTypeEncoding(canPerformMethod))
        class_addMethod(subclass, pasteAction, imp_implementationWithBlock(pasteBlock), method_getTypeEncoding(pasteMethod))
        objc_registerClassPair(subclass)
        return subclass
    }
}

private extension UIView {
    func descendants<View: UIView>(_ type: View.Type) -> [View] {
        subviews.flatMap { [$0 as? View].compactMap(\.self) + $0.descendants(type) }
    }
}
