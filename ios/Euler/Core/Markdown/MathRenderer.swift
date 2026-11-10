import SwiftMath
import UIKit

/// Typesets TeX with SwiftMath into images, cached, so a scrolling transcript
/// draws each formula once. SwiftMath covers less than KaTeX; a formula it
/// can't typeset returns nil and shows as source.
enum MathRenderer {
    struct Rendered {
        let image: UIImage
        /// How far the formula reaches below the text baseline.
        let descent: CGFloat
    }

    nonisolated(unsafe) private static let cache: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 500
        return cache
    }()

    private final class Box {
        let rendered: Rendered?
        init(_ rendered: Rendered?) { self.rendered = rendered }
    }

    static func render(_ tex: String, display: Bool, fontSize: CGFloat, color: UIColor) -> Rendered? {
        let key = "\(display)|\(fontSize)|\(color.hashValue)|\(tex)" as NSString
        if let hit = cache.object(forKey: key) { return hit.rendered }
        let rendered = typeset(tex, display: display, fontSize: fontSize, color: color)
        cache.setObject(Box(rendered), forKey: key)
        return rendered
    }

    private static func typeset(_ tex: String, display: Bool, fontSize: CGFloat, color: UIColor) -> Rendered? {
        let latex = tex.trimmingCharacters(in: .whitespacesAndNewlines)
        // The label typesets without drawing, which gives the baseline; the image
        // renderer draws in UIKit's flipped coordinates.
        let label = MTMathUILabel()
        label.labelMode = display ? .display : .text
        label.fontSize = fontSize
        label.latex = latex
        guard label.error == nil else { return nil }
        label.frame = CGRect(origin: .zero, size: label.intrinsicContentSize)
        label.layoutIfNeeded()
        guard let list = label.displayList else { return nil }
        let renderer = MTMathImage(
            latex: latex,
            fontSize: fontSize,
            textColor: color,
            labelMode: display ? .display : .text,
            textAlignment: .left
        )
        let (error, image) = renderer.asImage()
        guard error == nil, let image, image.size.width > 0 else { return nil }
        return Rendered(image: image, descent: list.descent)
    }
}
