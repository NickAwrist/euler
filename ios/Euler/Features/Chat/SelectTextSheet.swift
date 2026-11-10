import SwiftUI
import UIKit

/// A message's text where any part of it can be selected and copied. The
/// transcript's own text copies only whole, and a reply there is many views.
struct SelectTextSheet: View {
    let text: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette

    var body: some View {
        NavigationStack {
            SelectableText(text: text, color: UIColor(palette.foreground), tint: UIColor(palette.tint))
                .ignoresSafeArea(edges: .bottom)
                .background(palette.background)
                .navigationTitle("Select text")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    CloseToolbarItem { dismiss() }
                }
        }
        .presentationBackground(palette.background)
    }
}

/// A read-only UITextView: SwiftUI's text selection has no range handles on iOS.
struct SelectableText: UIViewRepresentable {
    let text: String
    /// Command output and the like, in the code font's place.
    var monospaced = false
    let color: UIColor
    let tint: UIColor

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.backgroundColor = .clear
        view.font = monospaced
            ? UIFontMetrics(forTextStyle: .footnote).scaledFont(for: .monospacedSystemFont(ofSize: 13, weight: .regular))
            : .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textContainerInset = UIEdgeInsets(top: 12, left: 12, bottom: 24, right: 12)
        view.alwaysBounceVertical = true
        view.accessibilityIdentifier = "Message text"
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
        view.textColor = color
        view.tintColor = tint
    }
}
