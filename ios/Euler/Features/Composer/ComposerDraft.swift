import EulerAPI
import Foundation
import Observation
import UIKit
import UniformTypeIdentifiers

/// What the user is writing in one chat: text and images not yet sent.
@Observable
final class ComposerDraft {
    var text = ""
    /// The model a new chat starts with, when the user picked one.
    var model: String?
    private(set) var images: [PendingImage] = []
    private(set) var sending = false
    var error: String?

    /// The web's limit per message.
    static let maxImages = 4
    /// The server's limit per image.
    static let maxImageBytes = 8 * 1024 * 1024

    var trimmedText: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    var canAddImages: Bool { images.count < Self.maxImages }

    /// Adds an image as JPEG, PNG, GIF or WebP data, re-encoding other formats
    /// and oversized photos as JPEG.
    func add(imageData data: Data, type: UTType?, filename: String?) {
        guard canAddImages else {
            error = "Attach up to \(Self.maxImages) images."
            return
        }
        guard let image = PendingImage(data: data, type: type, filename: filename) else {
            error = "That image can't be attached."
            return
        }
        images.append(image)
        error = nil
        Haptics.light()
    }

    func remove(_ image: PendingImage) {
        images.removeAll { $0.id == image.id }
    }

    /// Uploads the images to `sessionID`, then calls `send` with the text and
    /// their IDs. The draft clears only when the send succeeds; text typed
    /// meanwhile stays.
    func submit(sessionID: String, backend: Backend, send: (String, [String]) async throws -> Void) async -> Bool {
        let content = trimmedText
        guard !content.isEmpty, !sending else { return false }
        sending = true
        defer { sending = false }
        do {
            var ids: [String] = []
            for index in images.indices {
                if images[index].uploadedID == nil {
                    images[index].uploadedID = try await images[index].upload(to: sessionID, backend: backend)
                }
                ids.append(images[index].uploadedID ?? "")
            }
            try await send(content, ids)
            if trimmedText == content { text = "" }
            images = []
            error = nil
            Haptics.light()
            return true
        } catch {
            self.error = error.displayMessage
            Haptics.failure()
            return false
        }
    }
}

/// An image waiting to be sent, kept as the bytes the server stores.
struct PendingImage: Identifiable, Equatable {
    let id = UUID()
    let data: Data
    let mimeType: String
    let filename: String
    let thumbnail: UIImage
    /// Set once uploaded, so a failed send doesn't upload it twice.
    var uploadedID: String?

    init?(data: Data, type: UTType?, filename: String?) {
        guard let image = UIImage(data: data) else { return nil }
        let supported: [UTType: String] = [.png: "image/png", .jpeg: "image/jpeg", .gif: "image/gif", .webP: "image/webp"]
        if let type, let mime = supported[type], data.count <= ComposerDraft.maxImageBytes {
            self.data = data
            mimeType = mime
        } else {
            // HEIC and oversized photos become JPEG, scaled down until they fit.
            var scaled = image
            var jpeg = image.jpegData(compressionQuality: 0.85)
            while let current = jpeg, current.count > ComposerDraft.maxImageBytes {
                let size = CGSize(width: scaled.size.width * 0.7, height: scaled.size.height * 0.7)
                scaled = UIGraphicsImageRenderer(size: size).image { _ in scaled.draw(in: CGRect(origin: .zero, size: size)) }
                jpeg = scaled.jpegData(compressionQuality: 0.85)
            }
            guard let jpeg else { return nil }
            self.data = jpeg
            mimeType = "image/jpeg"
        }
        let base = (filename as NSString?)?.deletingPathExtension ?? "Image"
        let ext = mimeType.split(separator: "/").last.map(String.init) ?? "jpg"
        self.filename = "\(base.isEmpty ? "Image" : base).\(ext == "jpeg" ? "jpg" : ext)"
        thumbnail = image.preparingThumbnail(of: CGSize(width: 160, height: 160)) ?? image
    }

    func upload(to sessionID: String, backend: Backend) async throws -> String {
        var request = Euler_V1_CreateAttachmentRequest()
        request.sessionID = sessionID
        request.filename = filename
        request.mimeType = mimeType
        request.data = data
        return try await backend.attachments.createAttachment(request: request, headers: [:]).value().attachment.id
    }

    static func == (lhs: PendingImage, rhs: PendingImage) -> Bool {
        lhs.id == rhs.id && lhs.uploadedID == rhs.uploadedID
    }
}
