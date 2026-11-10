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
    /// Whether the message box has the keyboard; its screen sets it false when tapped elsewhere.
    var focused: FocusState<Bool>.Binding
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.typography) private var typography
    @State private var selection: TextSelection?
    @State private var choosingModel = false
    @State private var pickingPhotos = false
    @State private var photos: [PhotosPickerItem] = []
    @State private var takingPhoto = false

    private var draft: ComposerDraft { target.draft }

    var body: some View {
        @Bindable var draft = draft
        VStack(spacing: 8) {
            VStack(spacing: 0) {
                if !draft.images.isEmpty { imageStrip }
                HStack(alignment: .bottom, spacing: 8) {
                    attachMenu
                    TextField("Send a message...", text: $draft.text, selection: $selection, axis: .vertical)
                        .font(typography.body())
                        .lineLimit(1...8)
                        .focused(focused)
                        .padding(.vertical, 8)
                        .accessibilityLabel("Message")
                        .background { ImagePasteTarget(paste: pasteImage) }
                    sendButton
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                Rectangle().fill(palette.borderSubtle).frame(height: 1).padding(.horizontal, 10)
                HStack(spacing: 2) {
                    ModelButton(model: model, missing: missingModel) { choosingModel = true }
                    ThinkingMenu(model: model)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 6)
                .frame(height: 42)
            }
            .background(palette.surface, in: .rect(cornerRadius: 20))
            .overlay(RoundedRectangle(cornerRadius: 20).stroke(focused.wrappedValue ? palette.border : palette.borderSubtle))
            .animation(.easeOut(duration: 0.15), value: focused.wrappedValue)
            // Floats above the message box, as the web's picker does, so opening it or
            // filtering it never moves the box or the screen around it.
            .overlay(alignment: .top) {
                ComposerSuggestions(target: target, token: token) { completion in
                    draft.text = completion.text
                    selection = TextSelection(insertionPoint: completion.caret)
                } run: { command in
                    draft.text = ""
                    run(command)
                }
                .alignmentGuide(.top) { $0[.bottom] + 8 }
            }
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
        let ready = canSend || draft.sending
        if let chat = target.chat, chat.running, draft.trimmedText.isEmpty {
            Button("Stop generation", systemImage: "stop.fill") {
                Task { await session.notices.attempt { try await chat.stop() } }
            }
            .labelStyle(.iconOnly)
            .font(.footnote.weight(.bold))
            .frame(width: 36, height: 36)
            .background(Color.red.opacity(0.14), in: .rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.red.opacity(0.25)))
            .foregroundStyle(Color(hex: 0xFCA5A5))
        } else {
            Button("Send message", systemImage: "arrow.up") { Task { await send() } }
                .labelStyle(.iconOnly)
                .font(.body.weight(.semibold))
                .frame(width: 36, height: 36)
                // Pale while there is nothing to send, the tint once there is.
                .background(ready ? palette.tint : palette.accent, in: .rect(cornerRadius: 12))
                .foregroundStyle(ready ? palette.tintForeground : palette.accentForeground)
                .opacity(ready ? 1 : 0.4)
                .disabled(!canSend)
                .overlay { if draft.sending { ProgressView().tint(palette.tintForeground) } }
                .animation(.easeOut(duration: 0.15), value: ready)
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
        guard text.hasPrefix("/") else { return nil }
        return ChatCommand(rawValue: String(text.dropFirst()))
    }

    /// Opens the command's sheet; in a new chat it creates the chat first and opens it there, as the web does.
    private func run(_ command: ChatCommand) {
        let opens: ChatSheet = command == .workspace ? .artifacts(path: nil) : .workspace
        switch target {
        case .chat:
            sheet = opens
        case .new(_, let ephemeral, let start):
            guard let model else { return }
            Task {
                do {
                    let created = try await session.sessions.create(model: model.id, ephemeral: ephemeral)
                    session.chat(created.id).requestedSheet = opens
                    start(created.id)
                } catch {
                    draft.error = error.displayMessage
                }
            }
        }
    }

    // MARK: Images

    private var attachMenu: some View {
        Menu {
            Button("Photo Library", systemImage: "photo.on.rectangle", action: Haptics.selecting { pickingPhotos = true })
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button("Take Photo", systemImage: "camera", action: Haptics.selecting { takingPhoto = true })
            }
        } label: {
            Image(systemName: "photo.badge.plus")
                .font(.system(size: 19))
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

    /// An image pasted into the message box, as any paste arrives there.
    private func pasteImage(_ data: Data, _ type: UTType) {
        guard model?.acceptsImages != false else {
            draft.error = "The selected model does not accept images."
            return
        }
        draft.add(imageData: data, type: type, filename: "Pasted image")
    }
}

/// The selected model's provider logo and name; opens the model picker.
private struct ModelButton: View {
    let model: Euler_V1_Model?
    let missing: String?
    let action: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                if let model {
                    ProviderIcon(icon: .forModel(model), name: model.lab, size: 17)
                } else if let missing {
                    ProviderIcon(icon: .forModelID(missing), size: 17)
                }
                Text(label).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .font(.footnote)
            .foregroundStyle(palette.muted)
            .padding(.horizontal, 8)
            .frame(height: 32)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Model: \(model?.name ?? missing.map { "\($0) (unavailable)" } ?? "none")")
    }

    private var label: String {
        if let model { return model.name }
        if let missing { return "\(Euler_V1_Model.displayRoute(missing)) (unavailable)" }
        return "Choose model"
    }
}

/// The thinking level for the selected model, when it has a choice: the web's
/// Brain Level popover, with icons fuller for more thinking.
private struct ThinkingMenu: View {
    let model: Euler_V1_Model?
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var open = false

    var body: some View {
        let models = session.models
        let options = models.thinkingOptions(for: model)
        if let model, options.count > 1 {
            let current = models.effort(for: model)
            let option = options.first { $0.value == current }
            HStack(spacing: 2) {
                Rectangle().fill(palette.borderSubtle).frame(width: 1, height: 16).padding(.horizontal, 4)
                Button { open = true } label: {
                    HStack(spacing: 6) {
                        BrainIcon(tier: option?.tier ?? .off, size: 15)
                        Text(option?.label ?? "Thinking")
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold))
                    }
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                    .padding(.horizontal, 8)
                    .frame(height: 32)
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Thinking level")
                .accessibilityValue(option?.label ?? "Default")
                .popover(isPresented: $open, arrowEdge: .bottom) {
                    levels(options, current: current, model: model)
                        .presentationCompactAdaptation(.popover)
                        .presentationBackground(palette.surface)
                }
                .sensoryFeedback(.selection, trigger: current)
            }
        }
    }

    private func levels(_ options: [ThinkingOption], current: String?, model: Euler_V1_Model) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Brain Level")
                .font(.caption2.weight(.semibold))
                .textCase(.uppercase)
                .tracking(0.8)
                .foregroundStyle(palette.muted.opacity(0.75))
                .padding(.horizontal, 10)
                .padding(.top, 6)
                .padding(.bottom, 2)
            ForEach(options) { option in
                let selected = option.value == current
                Button {
                    session.models.setEffort(option.value, for: model)
                    open = false
                } label: {
                    HStack(spacing: 8) {
                        BrainIcon(tier: option.tier, size: 16)
                        Text(option.label)
                            .fontWeight(selected ? .medium : .regular)
                            .foregroundStyle(selected ? palette.foreground : palette.muted)
                        Spacer(minLength: 8)
                        if option.isDefault {
                            Text("Default")
                                .font(.system(size: 10))
                                .textCase(.uppercase)
                                .foregroundStyle(palette.muted.opacity(0.6))
                        }
                        Image(systemName: "checkmark")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(palette.foreground)
                            .opacity(selected ? 1 : 0)
                    }
                    .font(.subheadline)
                    .padding(.horizontal, 10)
                    .frame(minHeight: 44)
                    .background(selected ? palette.fill : .clear, in: .rect(cornerRadius: 8))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(6)
        .frame(width: 230)
    }
}

/// The web's brain icon for a thinking tier (ui/components/ThinkingLevelBar.tsx).
struct BrainIcon: View {
    let tier: ThinkingOption.Tier
    var size: CGFloat = 16
    @Environment(\.palette) private var palette

    var body: some View {
        Image(asset)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .foregroundStyle(color ?? palette.muted)
            .opacity(tier == .off ? 0.4 : 1)
            .accessibilityHidden(true)
    }

    private var asset: String {
        switch tier {
        case .off: "brain-off"
        case .low: "brain-low"
        case .medium: "brain-medium"
        case .high, .xhigh, .max: "brain-high"
        }
    }

    private var color: Color? {
        switch tier {
        case .xhigh: Color(hex: 0xC084FC)
        case .max: Color(hex: 0xF87171)
        default: nil
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
