import SwiftUI

/// Where an image comes from: a URL the server serves, or an uploaded attachment.
enum ImageSource: Hashable {
    case url(URL)
    case attachment(String)
}

/// An image card with a spinner while loading and a retry when it fails.
struct RemoteImage: View {
    let source: ImageSource
    let alt: String
    var contentMode: ContentMode = .fit
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var image: UIImage?
    @State private var failed = false
    @State private var attempt = 0

    init(url: URL, alt: String, contentMode: ContentMode = .fit) {
        source = .url(url)
        self.alt = alt
        self.contentMode = contentMode
    }

    init(attachment id: String, alt: String, contentMode: ContentMode = .fit) {
        source = .attachment(id)
        self.alt = alt
        self.contentMode = contentMode
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .accessibilityLabel(alt)
            } else if failed {
                Button {
                    failed = false
                    attempt += 1
                } label: {
                    Label("Retry", systemImage: "arrow.clockwise")
                        .font(.footnote)
                        .foregroundStyle(palette.muted)
                        .frame(maxWidth: .infinity, minHeight: 120)
                }
                .accessibilityLabel("Failed to load \(alt). Retry")
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .background(palette.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(palette.borderSubtle, lineWidth: 1))
        .task(id: "\(source)|\(attempt)") {
            do {
                image = switch source {
                case .url(let url): try await ImagePipeline.shared.image(at: url)
                case .attachment(let id): try await ImagePipeline.shared.attachment(id, backend: session.backend)
                }
            } catch is CancellationError {
            } catch {
                failed = true
            }
        }
    }
}
