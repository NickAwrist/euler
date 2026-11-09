import EulerAPI
import SwiftUI
import WebKit

/// The chat workspace's files as a tree, with native previews of Markdown,
/// text and images, and HTML in a web view with JavaScript off.
struct ArtifactsView: View {
    let chat: ChatStore
    let initialPath: String?
    @Environment(\.dismiss) private var dismiss
    @State private var path: [String] = []

    var body: some View {
        NavigationStack(path: $path) {
            ArtifactFolder(chat: chat, directory: "")
                .navigationDestination(for: String.self) { file in
                    ArtifactPreviewView(chat: chat, path: file)
                }
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .onAppear { if let initialPath, path.isEmpty { path = [initialPath] } }
    }
}

private struct ArtifactFolder: View {
    let chat: ChatStore
    let directory: String
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var entries: [Euler_V1_ArtifactEntry]?
    @State private var error: String?

    var body: some View {
        ThemedList {
            if let entries {
                if entries.isEmpty { Text("No files yet.").foregroundStyle(palette.muted) }
                ForEach(entries, id: \.path) { entry in
                    if entry.kind == .directory {
                        NavigationLink {
                            ArtifactFolder(chat: chat, directory: entry.path)
                        } label: {
                            Label(entry.name, systemImage: "folder")
                        }
                    } else {
                        NavigationLink(value: entry.path) {
                            Label(entry.name, systemImage: FileKind(path: entry.path).symbol)
                        }
                    }
                }
            } else if let error {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(directory.isEmpty ? "Files" : (directory as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        var request = Euler_V1_ListArtifactsRequest()
        request.sessionID = chat.id
        request.path = directory
        do {
            entries = try await session.backend.workspace.listArtifacts(request: request, headers: [:]).value().entries
            error = nil
        } catch {
            self.error = error.displayMessage
        }
    }
}

/// What a file is, for its icon and preview.
private enum FileKind {
    case markdown, html, image, text

    init(path: String) {
        switch (path as NSString).pathExtension.lowercased() {
        case "md", "markdown": self = .markdown
        case "html", "htm": self = .html
        case "png", "jpg", "jpeg", "gif", "webp", "svg": self = .image
        default: self = .text
        }
    }

    var symbol: String {
        switch self {
        case .markdown: "doc.richtext"
        case .html: "globe"
        case .image: "photo"
        case .text: "doc.text"
        }
    }
}

private struct ArtifactPreviewView: View {
    let chat: ChatStore
    let path: String
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography
    @State private var preview: Euler_V1_ArtifactPreview?
    @State private var error: String?
    @State private var download: URL?

    var body: some View {
        Group {
            if let preview {
                switch preview.content {
                case .text(let text) where FileKind(path: path) == .html:
                    HTMLPreview(html: text)
                case .text(let text) where FileKind(path: path) == .markdown:
                    ScrollView { MarkdownView(source: text).padding() }
                case .text(let text):
                    ScrollView([.vertical, .horizontal]) {
                        Text(text).font(typography.code(size: 13)).textSelection(.enabled).padding()
                    }
                case .image(let image):
                    if let uiImage = UIImage(data: image.data) {
                        ScrollView { Image(uiImage: uiImage).resizable().scaledToFit().padding() }
                    }
                case nil:
                    ContentUnavailableView("No preview", systemImage: "doc")
                }
            } else if let error {
                ContentUnavailableView("Can't preview", systemImage: "doc", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.background)
        .navigationTitle((path as NSString).lastPathComponent)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if let download {
                    ShareLink(item: download)
                } else {
                    Button("Download", systemImage: "arrow.down.circle") { Task { await fetchFile() } }
                }
            }
        }
        .task {
            var request = Euler_V1_PreviewArtifactRequest()
            request.sessionID = chat.id
            request.path = path
            do {
                preview = try await session.backend.workspace.previewArtifact(request: request, headers: [:]).value().preview
            } catch {
                self.error = error.displayMessage
            }
        }
    }

    /// Streams the file into a temporary copy the share sheet can hand on.
    private func fetchFile() async {
        var request = Euler_V1_DownloadFileRequest()
        request.sessionID = chat.id
        request.path = path
        await session.notices.attempt {
            var name = (path as NSString).lastPathComponent
            var data = Data()
            for try await message in session.backend.workspace.downloadFile(headers: [:]).messages(sending: request) {
                switch message.part {
                case .info(let info): name = info.name
                case .chunk(let chunk): data.append(chunk)
                case nil: break
                }
            }
            let file = URL.temporaryDirectory.appending(path: name)
            try data.write(to: file, options: .atomic)
            download = file
        }
    }
}

/// HTML as the web shows it: no scripts, no network, inline styles and data images only.
private struct HTMLPreview: UIViewRepresentable {
    let html: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = false
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        let policy = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'\">"
        view.loadHTMLString("<!doctype html><meta name=\"viewport\" content=\"width=device-width\">\(policy)\(html)", baseURL: nil)
    }
}
