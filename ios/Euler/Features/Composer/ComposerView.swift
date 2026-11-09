import EulerAPI
import PhotosUI
import SwiftUI

/// Where the composer sends: an open chat, or a new chat it creates first.
enum ComposerTarget {
    case chat(ChatStore)
    case new(ComposerDraft, ephemeral: Bool, start: (String) -> Void)

    var draft: ComposerDraft {
        switch self {
        case .chat(let chat): chat.draft
        case .new(let draft, _, _): draft
        }
    }

    var chat: ChatStore? {
        if case .chat(let chat) = self { chat } else { nil }
    }
}

/// The message box that rides the keyboard: text with suggestions, images,
/// and the model and thinking level for the next turn.
struct ComposerView: View {
    let target: ComposerTarget
    @Binding var sheet: ChatSheet?
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography
    @State private var selection: TextSelection?
    @State private var choosingModel = false
    @State private var pickingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var takingPhoto = false
    @FocusState private var focused: Bool

    private var draft: ComposerDraft { target.draft }

    var body: some View {
        @Bindable var draft = draft
        VStack(spacing: 8) {
            ComposerSuggestions(target: target, token: token) { completion in
                draft.text = completion.text
                selection = TextSelection(insertionPoint: completion.caret)
            } run: { command in
                draft.text = ""
                run(command)
            }
            VStack(spacing: 0) {
                if !draft.images.isEmpty { imageStrip }
                HStack(alignment: .bottom, spacing: 8) {
                    attachMenu
                    TextField("Send a message...", text: $draft.text, selection: $selection, axis: .vertical)
                        .font(typography.body())
                        .lineLimit(1...8)
                        .focused($focused)
                        .padding(.vertical, 8)
                        .accessibilityLabel("Message")
                    sendButton
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                Divider().overlay(palette.borderSubtle)
                HStack(spacing: 4) {
                    ModelButton(model: model, missing: missingModel) { choosingModel = true }
                    ThinkingMenu(model: model)
                    Spacer()
                }
                .padding(.horizontal, 8)
                .frame(height: 40)
            }
            .background(palette.surface, in: .rect(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(palette.border))
            if let error = draft.error {
                Text(error).font(.footnote).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .sheet(isPresented: $choosingModel) {
            ModelPickerSheet(selected: model?.id) { picked in
                Task { await select(picked) }
            }
        }
        .photosPicker(isPresented: $pickingPhotos, selection: $photos, maxSelectionCount: ComposerDraft.maxImages - draft.images.count, matching: .images)
        .onChange(of: photos) { _, items in
            photos = []
            Task { await addPhotos(items) }
        }
        .fullScreenCover(isPresented: $takingPhoto) {
            CameraPicker { image in
                if let data = image.jpegData(compressionQuality: 0.9) {
                    draft.add(imageData: data, type: .jpeg, filename: "Photo.jpg")
                }
            }
            .ignoresSafeArea()
        }
        .task {
            if !session.models.loaded { await session.models.load() }
        }
    }

    private var token: ComposerToken? {
        let caret: String.Index = switch selection?.indices {
        case .selection(let range): range.upperBound
        default: draft.text.endIndex
        }
        guard caret <= draft.text.endIndex else { return nil }
        return ComposerToken.find(in: draft.text, caret: caret)
    }

    // MARK: Model

    /// The model the next turn uses: the chat's, the new chat's pick, or the default.
    private var model: Euler_V1_Model? {
        let models = session.models
        let chosen = target.chat?.session?.model ?? draft.model
        if let chosen, let model = models.model(chosen) { return model }
        if chosen == nil {
            let saved = session.preferences.settings.defaultModel
            return models.selectable.first { $0.id == saved } ?? models.selectable.first
        }
        return nil
    }

    /// A saved model the catalog no longer offers, shown so the user knows to pick another.
    private var missingModel: String? {
        guard model == nil, let chosen = target.chat?.session?.model ?? draft.model, !chosen.isEmpty else { return nil }
        return session.models.loaded ? chosen : nil
    }

    private func select(_ model: Euler_V1_Model) async {
        if let chat = target.chat {
            await session.notices.attempt { try await chat.setModel(model.id) }
        } else {
            draft.model = model.id
        }
    }

    // MARK: Sending

    private var canSend: Bool {
        !draft.trimmedText.isEmpty && !draft.sending && model != nil
    }

    @ViewBuilder
    private var sendButton: some View {
        if let chat = target.chat, chat.running, draft.trimmedText.isEmpty {
            Button("Stop generation", systemImage: "stop.fill") {
                Task { await session.notices.attempt { try await chat.stop() } }
            }
            .labelStyle(.iconOnly)
            .font(.body.weight(.semibold))
            .frame(width: 36, height: 36)
            .background(palette.foreground, in: .rect(cornerRadius: 12))
            .foregroundStyle(palette.background)
        } else {
            Button("Send message", systemImage: "arrow.up") { Task { await send() } }
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .frame(width: 36, height: 36)
                .background(canSend ? palette.foreground : palette.muted.opacity(0.5), in: .rect(cornerRadius: 12))
                .foregroundStyle(palette.background)
                .disabled(!canSend)
                .overlay { if draft.sending { ProgressView().tint(palette.background) } }
        }
    }

    private func send() async {
        guard let model else { return }
        if !draft.images.isEmpty, !model.acceptsImages {
            draft.error = "The selected model does not accept images."
            return
        }
        if let command = exactCommand {
            draft.text = ""
            run(command)
            return
        }
        let effort = session.models.effort(for: model)
        switch target {
        case .chat(let chat):
            _ = await draft.submit(sessionID: chat.id, backend: session.backend) { content, ids in
                try await chat.send(content, attachments: ids, model: model.id, effort: effort)
            }
        case .new(_, let ephemeral, let start):
            do {
                let created = try await session.sessions.create(model: model.id, ephemeral: ephemeral)
                let chat = session.chat(created.id)
                let sent = await draft.submit(sessionID: created.id, backend: session.backend) { content, ids in
                    try await chat.send(content, attachments: ids, model: model.id, effort: effort)
                }
                if sent { start(created.id) }
            } catch {
                draft.error = error.displayMessage
            }
        }
    }

    private var exactCommand: ChatCommand? {
        let text = draft.trimmedText
        guard text.hasPrefix("/"), target.chat != nil else { return nil }
        return ChatCommand(rawValue: String(text.dropFirst()))
    }

    private func run(_ command: ChatCommand) {
        guard target.chat != nil else {
            draft.error = "Send a message first, then choose a workspace."
            return
        }
        switch command {
        case .directory, .link, .sandbox: sheet = .workspace
        case .workspace: sheet = .artifacts(path: nil)
        }
    }

    // MARK: Images

    private var attachMenu: some View {
        Menu {
            Button("Photo Library", systemImage: "photo.on.rectangle") { pickingPhotos = true }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Take Photo", systemImage: "camera") { takingPhoto = true }
            }
            Button("Paste Image", systemImage: "doc.on.clipboard") { pasteImage() }
                .disabled(!UIPasteboard.general.hasImages)
        } label: {
            Image(systemName: "photo.badge.plus")
                .font(.title3)
                .foregroundStyle(palette.muted)
                .frame(width: 36, height: 36)
        }
        .disabled(!draft.canAddImages || model?.acceptsImages == false)
        .accessibilityLabel("Attach images")
    }

    private var imageStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(draft.images) { image in
                    Image(uiImage: image.thumbnail)
                        .resizable()
                        .scaledToFill()
                        .frame(width: 64, height: 64)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(alignment: .topTrailing) {
                            Button("Remove image", systemImage: "xmark.circle.fill") { draft.remove(image) }
                                .labelStyle(.iconOnly)
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .black.opacity(0.6))
                                .offset(x: 6, y: -6)
                        }
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
        }
    }

    private func addPhotos(_ items: [PhotosPickerItem]) async {
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            draft.add(imageData: data, type: item.supportedContentTypes.first, filename: nil)
        }
    }

    private func pasteImage() {
        let board = UIPasteboard.general
        for type in [UTType.png, .jpeg, .gif, .webP] {
            if let data = board.data(forPasteboardType: type.identifier) {
                draft.add(imageData: data, type: type, filename: "Pasted image")
                return
            }
        }
        if let image = board.image, let data = image.pngData() {
            draft.add(imageData: data, type: .png, filename: "Pasted image")
        }
    }
}

/// The selected model's name and icon; opens the model picker.
private struct ModelButton: View {
    let model: Euler_V1_Model?
    let missing: String?
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                ProviderIcon(provider: model?.provider ?? .unspecified)
                Text(model?.name ?? missing.map { "\($0) (unavailable)" } ?? "Choose model").lineLimit(1)
                Image(systemName: "chevron.down").font(.caption2)
            }
            .font(.subheadline)
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 8)
            .frame(height: 32)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Model: \(model?.name ?? missing.map { "\($0) (unavailable)" } ?? "none")")
    }
}

/// The thinking level for the selected model, when it has a choice.
private struct ThinkingMenu: View {
    let model: Euler_V1_Model?
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette

    var body: some View {
        let models = session.models
        let options = models.thinkingOptions(for: model)
        if let model, options.count > 1 {
            let current = models.effort(for: model)
            Menu {
                Picker("Thinking", selection: Binding(
                    get: { current ?? "" },
                    set: { models.setEffort($0, for: model) }
                )) {
                    ForEach(options) { option in
                        Text(option.label).tag(option.value)
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: current.map { ThinkingOption.tier(of: $0) == .off } == true ? "brain.slash" : "brain")
                    Text(options.first { $0.value == current }?.label ?? "Thinking")
                    Image(systemName: "chevron.down").font(.caption2)
                }
                .font(.subheadline)
                .foregroundStyle(palette.muted)
                .padding(.horizontal, 8)
                .frame(height: 32)
            }
            .accessibilityLabel("Thinking level")
            .sensoryFeedback(.selection, trigger: current)
        }
    }
}

/// The provider's mark, as the web shows beside model names.
struct ProviderIcon: View {
    let provider: Euler_V1_ModelProvider

    var body: some View {
        Image(systemName: symbol)
            .font(.footnote)
            .frame(width: 18, height: 18)
            .accessibilityHidden(true)
    }

    private var symbol: String {
        switch provider {
        case .ollama: "desktopcomputer"
        case .openrouter: "point.3.filled.connected.trianglepath.dotted"
        case .chatgpt: "bubble.left.and.text.bubble.right"
        default: "cpu"
        }
    }
}

/// The system camera, for one photo.
struct CameraPicker: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker

        init(parent: CameraPicker) {
            self.parent = parent
        }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }
    }
}
