import SwiftUI

/// A Form in the theme's colors, so settings change with the theme as the web's do.
struct ThemedForm<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.palette) private var palette

    var body: some View {
        Form {
            Group { content }.listRowBackground(palette.surface)
        }
        // Presented sheets don't inherit the root's toggle style, and keep the tint
        // they opened with, so both follow the palette here.
        .toggleStyle(ThemedSwitchStyle())
        .buttonStyle(RowButtonStyle())
        .labelStyle(RowLabelStyle())
        .tint(palette.tint)
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .scrollDismissesKeyboard(.interactively)
        .background { KeyboardDismissingTaps() }
    }
}

/// A List in the theme's colors.
struct ThemedList<Content: View>: View {
    @ViewBuilder let content: Content
    @Environment(\.palette) private var palette

    var body: some View {
        List {
            Group { content }.listRowBackground(palette.surface)
        }
        .toggleStyle(ThemedSwitchStyle())
        .buttonStyle(RowButtonStyle())
        .labelStyle(RowLabelStyle())
        .tint(palette.tint)
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .scrollDismissesKeyboard(.interactively)
        .background { KeyboardDismissingTaps() }
    }
}

/// Puts the keyboard away when a tap lands anywhere but in a text field, as a
/// field on the web loses focus. A field of several lines has no key that does.
private struct KeyboardDismissingTaps: UIViewRepresentable {
    func makeUIView(context: Context) -> Watcher {
        let watcher = Watcher()
        watcher.isUserInteractionEnabled = false
        return watcher
    }

    func updateUIView(_ watcher: Watcher, context: Context) {}

    /// Watches its window's taps while it is on screen, without taking them from anything.
    final class Watcher: UIView, UIGestureRecognizerDelegate {
        private lazy var tap: UITapGestureRecognizer = {
            let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
            tap.cancelsTouchesInView = false
            tap.delegate = self
            return tap
        }()

        override func didMoveToWindow() {
            super.didMoveToWindow()
            tap.view?.removeGestureRecognizer(tap)
            window?.addGestureRecognizer(tap)
        }

        @objc private func tapped() {
            window?.endEditing(true)
        }

        /// A tap in a text field belongs to the field: it moves the caret or the focus.
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            var view = touch.view
            while let current = view {
                if current is UITextInput { return false }
                view = current.superview
            }
            return true
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            true
        }
    }
}

/// A button whose action ticks, drawn by `style`. Menus, rows and form buttons
/// all tick alike, so the tick belongs to the styles rather than to each action.
private struct TickingButton<Style: ButtonStyle>: View {
    let configuration: PrimitiveButtonStyleConfiguration
    let style: Style

    var body: some View {
        Button(role: configuration.role) {
            Haptics.select()
            configuration.trigger()
        } label: {
            configuration.label
        }
        .buttonStyle(style)
    }
}

/// A row that acts, in the foreground color with a muted icon. The tint is for
/// controls and the buttons that save, not for every label in a form.
struct RowButtonStyle: PrimitiveButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        TickingButton(configuration: configuration, style: Appearance())
    }

    private struct Appearance: ButtonStyle {
        func makeBody(configuration: Configuration) -> some View {
            Row(configuration: configuration)
        }
    }

    private struct Row: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.palette) private var palette
        @Environment(\.isEnabled) private var enabled

        var body: some View {
            let destructive = configuration.role == .destructive
            configuration.label
                .foregroundStyle(destructive ? Color.red : palette.foreground, destructive ? Color.red : palette.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
                .opacity(enabled ? (configuration.isPressed ? 0.5 : 1) : 0.4)
        }
    }
}

/// A row's icon in the secondary color, in the column a list gives icons.
struct RowLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 12) {
            configuration.icon.foregroundStyle(.secondary).frame(width: 24)
            configuration.title
        }
    }
}

extension View {
    /// A menu picker's chosen value in the muted color, as a form's other values are.
    func mutedPickerValue() -> some View {
        modifier(MutedPickerValue())
    }
}

private struct MutedPickerValue: ViewModifier {
    @Environment(\.palette) private var palette

    func body(content: Content) -> some View {
        content.tint(palette.muted)
    }
}

/// The mark at a row's trailing edge that says it opens something.
struct RowChevron: View {
    var systemName = "chevron.right"
    @Environment(\.palette) private var palette

    var body: some View {
        Image(systemName: systemName)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(palette.muted.opacity(0.5))
            .accessibilityHidden(true)
    }
}

/// A form's actions side by side under the section they act on. They keep their
/// place whether or not they can be used yet, so nothing moves when they can.
struct FormActions<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        Section {
            HStack(spacing: 10) { content }
                .buttonStyle(FormActionStyle())
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
        }
        .listSectionSpacing(12)
    }
}

/// One of a form's actions: filled with the tint when it is the one that
/// saves, outlined otherwise.
struct FormActionStyle: PrimitiveButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        TickingButton(configuration: configuration, style: Appearance(prominent: prominent))
    }

    private struct Appearance: ButtonStyle {
        let prominent: Bool

        func makeBody(configuration: Configuration) -> some View {
            Action(configuration: configuration, prominent: prominent)
        }
    }

    private struct Action: View {
        let configuration: ButtonStyleConfiguration
        let prominent: Bool
        @Environment(\.palette) private var palette
        @Environment(\.isEnabled) private var enabled

        var body: some View {
            configuration.label
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(prominent ? palette.tintForeground : configuration.role == .destructive ? .red : palette.foreground)
                .frame(maxWidth: .infinity, minHeight: 46)
                .background(prominent ? palette.tint : palette.surface, in: .capsule)
                .overlay { if !prominent { Capsule().stroke(palette.borderSubtle) } }
                .contentShape(.capsule)
                .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.4)
                .animation(.easeOut(duration: 0.15), value: enabled)
        }
    }
}

/// The X that leaves a sheet, or abandons what it was editing. It takes the
/// confirmation's place, the trailing corner, apart from a page's own buttons.
struct CloseToolbarItem: ToolbarContent {
    var label = "Close"
    var placement = ToolbarItemPlacement.confirmationAction
    let action: () -> Void

    var body: some ToolbarContent {
        // Its own bubble, apart from the page's buttons beside it.
        ToolbarSpacer(.fixed, placement: placement)
        ToolbarItem(placement: placement) { CloseButton(label: label, action: action) }
    }

    private struct CloseButton: View {
        let label: String
        let action: () -> Void
        @Environment(\.palette) private var palette

        var body: some View {
            Button(label, systemImage: "xmark", role: .close) {
                Haptics.select()
                action()
            }
            // The bar's plain glass rather than the filled button a confirmation gets,
            // and the bar's color even in a sheet opened from a tinted form.
            .buttonStyle(.borderless)
            .tint(palette.accent)
        }
    }
}

/// The system paste button, which reads the clipboard without a permission
/// prompt, in the theme's neutral fill.
struct PasteTextButton: View {
    let pasted: (String) -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        PasteButton(payloadType: String.self) { strings in
            if let first = strings.first { pasted(first) }
        }
        .labelStyle(.titleAndIcon)
        .buttonBorderShape(.capsule)
        .tint(palette.fill)
        .foregroundStyle(palette.foreground)
    }
}

/// The system switch in the theme's tint. The accent is near white on most
/// themes, which left switches white on white.
struct ThemedSwitchStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        ThemedSwitch(configuration: configuration)
    }

    private struct ThemedSwitch: View {
        let configuration: ToggleStyleConfiguration
        @Environment(\.palette) private var palette

        var body: some View {
            Toggle(configuration).toggleStyle(.switch).tint(palette.tint)
        }
    }
}

/// Scales down a little while pressed, as the web's buttons do.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .brightness(configuration.isPressed ? -0.06 : 0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
