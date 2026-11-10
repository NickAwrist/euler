import EulerAPI
import ImageIO
import UIKit

/// Loads transcript images once: ComfyUI outputs and favicons by URL through a
/// disk-backed URL cache, attachments through `GetAttachmentData` into the
/// caches directory. Decoded images are downsampled and kept in memory.
actor ImagePipeline {
    static let shared = ImagePipeline()

    private let memory = NSCache<NSString, UIImage>()
    private let session: URLSession
    private let directory: URL

    private init() {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 256 << 20)
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: configuration)
        directory = URL.cachesDirectory.appending(path: "attachments", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        memory.totalCostLimit = 96 << 20
    }

    func image(at url: URL) async throws -> UIImage {
        let key = url.absoluteString as NSString
        if let hit = memory.object(forKey: key) { return hit }
        let (data, response) = try await session.data(from: url)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try remember(data, key: key)
    }

    /// An uploaded attachment's image, read from disk after the first download.
    func attachment(_ id: String, backend: Backend) async throws -> UIImage {
        let key = "attachment:\(id)" as NSString
        if let hit = memory.object(forKey: key) { return hit }
        let file = directory.appending(path: id)
        if let data = try? Data(contentsOf: file) { return try remember(data, key: key) }
        var request = Euler_V1_GetAttachmentDataRequest()
        request.id = id
        let response = try await backend.attachments.getAttachmentData(request: request, headers: [:]).value()
        try? response.data.write(to: file, options: .atomic)
        return try remember(response.data, key: key)
    }

    private func remember(_ data: Data, key: NSString) throws -> UIImage {
        guard let image = Self.downsample(data, maxPixels: 2048) else { throw URLError(.cannotDecodeContentData) }
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        memory.setObject(image, forKey: key, cost: cost)
        return image
    }

    private static func downsample(_ data: Data, maxPixels: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}
