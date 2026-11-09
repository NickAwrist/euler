import EulerAPI
import SwiftUI

/// Theme and fonts, shared with the web and applied to the transcript. The
/// web's chat width has no phone equivalent.
struct AppearanceSettingsView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        let appearance = session.preferences.appearance
        Form {
            Section {
                ResponsePreview()
                    .environment(\.palette, Palette(appearance.theme))
                    .environment(\.typography, Typography(font: appearance.font, codeFont: appearance.codeFont))
                    .listRowInsets(EdgeInsets())
            }
            Section("Theme") {
                Picker("Theme", selection: binding(\.theme) { $0.theme = $1 }) {
                    ForEach(Self.themes, id: \.0) { theme, name in
                        HStack {
                            Circle().fill(Palette(theme).accent).frame(width: 14, height: 14)
                            Text(name)
                        }
                        .tag(theme)
                    }
                }
                .pickerStyle(.inline)
                .labelsHidden()
            }
            Section("Fonts") {
                Picker("Font style", selection: binding(\.font) { $0.font = $1 }) {
                    ForEach(Self.fonts, id: \.0) { font, name in Text(name).tag(font) }
                }
                Picker("Code block font", selection: binding(\.codeFont) { $0.codeFont = $1 }) {
                    ForEach(Self.codeFonts, id: \.0) { font, name in Text(name).tag(font) }
                }
            }
        }
        .navigationTitle("Appearance")
    }

    /// The saved value, with unknown or unset values read as the default, and a setter that saves.
    private func binding<Value: Hashable>(
        _ path: KeyPath<Euler_V1_Appearance, Value>,
        save: @escaping (inout Euler_V1_UpdatePreferencesRequest.AppearancePatch, Value) -> Void
    ) -> Binding<Value> where Value: AppearanceChoice {
        Binding(
            get: { Value.known(session.preferences.appearance[keyPath: path]) },
            set: { value in
                Haptics.light()
                savePreferences(session) { save(&$0.appearance, value) }
            }
        )
    }

    static let themes: [(Euler_V1_Appearance.Theme, String)] = [
        (.default, "Default"), (.oneDark, "One Dark"), (.dracula, "Dracula"),
        (.nord, "Nord"), (.catppuccin, "Catppuccin"), (.github, "GitHub"),
    ]
    static let fonts: [(Euler_V1_Appearance.Font, String)] = [
        (.default, "Default"), (.serif, "Serif"), (.system, "System"), (.geist, "Geist"),
        (.sourceSans, "Source Sans 3"), (.atkinson, "Atkinson Hyperlegible Next"), (.opendyslexic, "OpenDyslexic"),
    ]
    static let codeFonts: [(Euler_V1_Appearance.CodeFont, String)] = [
        (.default, "Default"), (.geistMono, "Geist Mono"), (.jetbrainsMono, "JetBrains Mono"), (.sourceCode, "Source Code Pro"),
    ]
}

/// An appearance choice whose unset or unknown values read as Default.
protocol AppearanceChoice {
    static func known(_ value: Self) -> Self
}

extension Euler_V1_Appearance.Theme: AppearanceChoice {
    static func known(_ value: Self) -> Self {
        AppearanceSettingsView.themes.contains { $0.0 == value } ? value : .default
    }
}

extension Euler_V1_Appearance.Font: AppearanceChoice {
    static func known(_ value: Self) -> Self {
        AppearanceSettingsView.fonts.contains { $0.0 == value } ? value : .default
    }
}

extension Euler_V1_Appearance.CodeFont: AppearanceChoice {
    static func known(_ value: Self) -> Self {
        AppearanceSettingsView.codeFonts.contains { $0.0 == value } ? value : .default
    }
}

/// A sample reply in the chosen theme and fonts.
private struct ResponsePreview: View {
    @Environment(\.palette) private var palette

    var body: some View {
        MarkdownView(source: """
        The **quadratic formula** solves $$ax^2 + bx + c = 0$$ for *x*.

        ```swift
        let roots = solve(a: 1, b: -3, c: 2)
        ```
        """)
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.background)
        .accessibilityLabel("Response preview")
    }
}
