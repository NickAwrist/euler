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
        .tint(palette.tint)
        .scrollContentBackground(.hidden)
        .background(palette.background)
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
        .tint(palette.tint)
        .scrollContentBackground(.hidden)
        .background(palette.background)
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
