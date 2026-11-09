import EulerAPI
import HighlightSwift
import SwiftUI

/// The web's theme tokens (ui/index.css). Every theme is dark.
struct Palette: Equatable {
    var background: Color
    var surface: Color
    var foreground: Color
    /// The web's muted foreground: secondary text and icons.
    var muted: Color
    /// The web's muted background: selected rows, user messages, pressed controls.
    var fill: Color
    var accent: Color
    var border: Color
    var borderSubtle: Color
    /// The theme's signature hue for controls the pale accent would wash out:
    /// switches, checkmarks, unread dots. Default uses the gold of the Euler mark.
    var tint: Color
    /// The highlight.js theme closest to the web's code colors.
    var code: HighlightTheme

    static let `default` = Palette(
        background: Color(hex: 0x171717), surface: Color(hex: 0x212121), foreground: Color(hex: 0xE8E8E8),
        muted: Color(hex: 0x9B9B9B), fill: Color(hex: 0x262626), accent: Color(hex: 0xE8E8E8),
        border: Color(hex: 0x3A3A3A), borderSubtle: Color(hex: 0x2A2A2A), tint: Color(hex: 0xD4AF37), code: .xcode
    )

    /// Ephemeral chats, as the web's amber-400.
    static let ephemeral = Color(hex: 0xFBBF24)
    /// Favorite stars and the New badge.
    static let favorite = Color(hex: 0xC6AD65)
    /// Connected and success states, as the web's emerald-500.
    static let positive = Color(hex: 0x10B981)

    /// Text and icons on the accent, such as the send button's arrow.
    var accentForeground: Color { background }

    init(
        background: Color, surface: Color, foreground: Color, muted: Color, fill: Color, accent: Color,
        border: Color, borderSubtle: Color, tint: Color, code: HighlightTheme
    ) {
        self.background = background
        self.surface = surface
        self.foreground = foreground
        self.muted = muted
        self.fill = fill
        self.accent = accent
        self.border = border
        self.borderSubtle = borderSubtle
        self.tint = tint
        self.code = code
    }

    init(_ theme: Euler_V1_Appearance.Theme) {
        switch theme {
        case .oneDark:
            self.init(
                background: Color(hex: 0x21252B), surface: Color(hex: 0x282C34), foreground: Color(hex: 0xD7DAE0),
                muted: Color(hex: 0xA3AAB7), fill: Color(hex: 0x2E333D), accent: Color(hex: 0x9AB9DF),
                border: Color(hex: 0x454C59), borderSubtle: Color(hex: 0x343B46), tint: Color(hex: 0x61AFEF), code: .atomOne
            )
        case .dracula:
            self.init(
                background: Color(hex: 0x24242E), surface: Color(hex: 0x2C2C38), foreground: Color(hex: 0xEEEDF3),
                muted: Color(hex: 0xAAA7BA), fill: Color(hex: 0x333340), accent: Color(hex: 0xBAA6D9),
                border: Color(hex: 0x494554), borderSubtle: Color(hex: 0x393643), tint: Color(hex: 0xBD93F9), code: .tokyoNight
            )
        case .nord:
            self.init(
                background: Color(hex: 0x2E3440), surface: Color(hex: 0x353D4B), foreground: Color(hex: 0xECEFF4),
                muted: Color(hex: 0xB0BACB), fill: Color(hex: 0x3B4252), accent: Color(hex: 0x9FC4CF),
                border: Color(hex: 0x505C70), borderSubtle: Color(hex: 0x434C5E), tint: Color(hex: 0x88C0D0), code: .standard
            )
        case .catppuccin:
            self.init(
                background: Color(hex: 0x242331), surface: Color(hex: 0x2C2B3B), foreground: Color(hex: 0xDDD9EE),
                muted: Color(hex: 0xB4ADC9), fill: Color(hex: 0x343245), accent: Color(hex: 0xC2AFE2),
                border: Color(hex: 0x504961), borderSubtle: Color(hex: 0x403A50), tint: Color(hex: 0xCBA6F7), code: .paraiso
            )
        case .github:
            self.init(
                background: Color(hex: 0x0D1117), surface: Color(hex: 0x161B22), foreground: Color(hex: 0xE6EDF3),
                muted: Color(hex: 0x9DA7B3), fill: Color(hex: 0x21262D), accent: Color(hex: 0x91B9E8),
                border: Color(hex: 0x39424E), borderSubtle: Color(hex: 0x30363D), tint: Color(hex: 0x4493F8), code: .github
            )
        default:
            self = .default
        }
    }
}

/// The transcript's interface and code fonts, from Appearance settings.
struct Typography: Equatable {
    var font: Euler_V1_Appearance.Font = .default
    var codeFont: Euler_V1_Appearance.CodeFont = .default

    /// Reply text at `size`, scaled with Dynamic Type.
    func body(size: CGFloat = 16, relativeTo style: Font.TextStyle = .body) -> Font {
        switch font {
        case .serif: .custom("SourceSerif4Variable-Roman", size: size, relativeTo: style)
        case .geist: .custom("Geist-Regular", size: size, relativeTo: style)
        case .sourceSans: .custom("SourceSans3-Roman", size: size, relativeTo: style)
        case .atkinson: .custom("AtkinsonHyperlegibleNext-Regular", size: size, relativeTo: style)
        case .opendyslexic: .custom("OpenDyslexic-Regular", size: size * 0.9, relativeTo: style)
        // The web's default, IBM Plex Sans, falls back to the system font; so does System.
        default: .system(size: size, design: .default)
        }
    }

    func code(size: CGFloat = 14) -> Font {
        switch codeFont {
        case .geistMono: .custom("GeistMono-Regular", size: size, relativeTo: .callout)
        case .jetbrainsMono: .custom("JetBrainsMono-Regular", size: size, relativeTo: .callout)
        case .sourceCode: .custom("SourceCodePro-Regular", size: size, relativeTo: .callout)
        default: .system(size: size, design: .monospaced)
        }
    }

    /// Registers the web's bundled font files (public/fonts) for this process.
    static func registerBundledFonts() {
        let urls = Bundle.main.urls(forResourcesWithExtension: "woff2", subdirectory: "fonts") ?? []
        CTFontManagerRegisterFontURLs(urls as CFArray, .process, true, nil)
    }
}

extension EnvironmentValues {
    @Entry var palette = Palette.default
    @Entry var typography = Typography()
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
