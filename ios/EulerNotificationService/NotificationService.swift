import UIKit
import UserNotifications

/// Adds a reply's generated image to its notification. The server sends the
/// image's path; the address comes from the app through the shared app group.
/// Without the address or a reachable server, the notification arrives as text.
final class NotificationService: UNNotificationServiceExtension {
    /// Keys the app writes in `SharedSettings`; keep the two in step.
    private static let suiteName = "group.net.spaceheater.euler"
    private static let serverURLKey = "EulerServerURL"

    private var content: UNMutableNotificationContent?
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var download: URLSessionDownloadTask?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        self.content = content
        self.contentHandler = contentHandler
        let shared = UserDefaults(suiteName: Self.suiteName)
        guard let path = content.userInfo["image"] as? String,
              let server = shared?.string(forKey: Self.serverURLKey).flatMap(URL.init(string:)),
              let url = URL(string: path, relativeTo: server)
        else {
            contentHandler(content)
            return
        }
        download = URLSession.shared.downloadTask(with: url) { [weak self] location, response, _ in
            self?.attach(location, response: response)
        }
        download?.resume()
    }

    override func serviceExtensionTimeWillExpire() {
        download?.cancel()
        if let content { contentHandler?(content) }
    }

    private func attach(_ location: URL?, response: URLResponse?) {
        guard let content, let contentHandler else { return }
        // ComfyUI may return WebP, which attachments don't take, so images are re-encoded as JPEG.
        let file = FileManager.default.temporaryDirectory.appending(path: "\(UUID().uuidString).jpg")
        if let location, (response as? HTTPURLResponse)?.statusCode == 200,
           let jpeg = UIImage(contentsOfFile: location.path)?.jpegData(compressionQuality: 0.9),
           (try? jpeg.write(to: file)) != nil,
           let attachment = try? UNNotificationAttachment(identifier: "image", url: file) {
            content.attachments = [attachment]
        }
        contentHandler(content)
    }
}
