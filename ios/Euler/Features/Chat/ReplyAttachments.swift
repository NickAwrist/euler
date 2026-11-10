import EulerAPI
import SwiftUI

/// What tools attached to a reply: generated images the text doesn't show,
/// workspace files to preview, and the web sources it read.
struct ReplyAttachments: View {
    let attachments: [Euler_V1_MessageAttachment]
    let content: String
    @Binding var sheet: ChatSheet?
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette

    var body: some View {
        let images = generatedImages
        let files = attachments.compactMap { if case .file(let file) = $0.kind { file } else { nil } }
        let sources = attachments.compactMap { if case .webSource(let source) = $0.kind { source } else { nil } }
        if !images.isEmpty || !files.isEmpty || !sources.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(images, id: \.self) { path in
                    if let url = session.backend.url(forPath: path) {
                        RemoteImage(url: url, alt: "Generated image")
                            .frame(maxWidth: 320, maxHeight: 320, alignment: .leading)
                    }
                }
                ForEach(files, id: \.id) { file in
                    Button {
                        sheet = .artifacts(path: file.path)
                    } label: {
                        Label(file.name, systemImage: "doc.text")
                            .font(.subheadline)
                            .lineLimit(1)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(palette.surface, in: .capsule)
                            .overlay(Capsule().stroke(palette.borderSubtle))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Preview \(file.name)")
                }
                if !sources.isEmpty {
                    SourcesChip(sources: sources) { sheet = .sources(sources) }
                }
            }
        }
    }

    /// Generated images, leaving out those the reply's Markdown already shows.
    private var generatedImages: [String] {
        attachments.compactMap { attachment in
            guard case .generatedImage(let image) = attachment.kind, !content.contains(image.url) else { return nil }
            return image.url
        }
    }
}

/// Up to three favicons and "N sources".
private struct SourcesChip: View {
    let sources: [Euler_V1_WebSourceAttachment]
    let open: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: open) {
            HStack(spacing: 8) {
                HStack(spacing: -6) {
                    ForEach(Array(Set(sources.compactMap(\.host)).sorted().prefix(3)), id: \.self) { host in
                        Favicon(host: host).frame(width: 18, height: 18)
                    }
                }
                Text(sources.count == 1 ? "1 source" : "\(sources.count) sources")
                    .font(.subheadline)
                Image(systemName: "chevron.right").font(.caption2)
            }
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(palette.surface, in: .capsule)
            .overlay(Capsule().stroke(palette.borderSubtle))
        }
        .buttonStyle(.plain)
    }
}

/// A site's icon, through the server's favicon route.
struct Favicon: View {
    let host: String
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                Image(systemName: "globe").resizable().scaledToFit().foregroundStyle(palette.muted)
            }
        }
        .clipShape(Circle())
        .background(Circle().fill(palette.background))
        .task(id: host) {
            guard let url = session.backend.url(forPath: "/api/favicons/\(host)") else { return }
            image = try? await ImagePipeline.shared.image(at: url)
        }
    }
}

struct SourcesSheet: View {
    let sources: [Euler_V1_WebSourceAttachment]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(sources, id: \.url) { source in
                if let url = URL(string: source.url) {
                    Link(destination: url) {
                        HStack(spacing: 12) {
                            if let host = source.host { Favicon(host: host).frame(width: 20, height: 20) }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(source.title).lineLimit(2)
                                Text(source.host ?? source.url).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Sources")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { CloseToolbarItem { dismiss() } }
        }
        .presentationDetents([.medium, .large])
    }
}

extension Euler_V1_WebSourceAttachment {
    var host: String? { URL(string: url)?.host() }
}
