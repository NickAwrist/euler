import SwiftUI
import VisionKit

/// Scans QR codes with the camera until `onCode` accepts one.
struct QRScanner: UIViewControllerRepresentable {
    /// Returns whether the code was used, which ends scanning.
    let onCode: (String) -> Bool

    static var isAvailable: Bool {
        DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Bool

        init(onCode: @escaping (String) -> Bool) {
            self.onCode = onCode
        }

        func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let barcode) in items {
                if let payload = barcode.payloadStringValue, onCode(payload) {
                    scanner.stopScanning()
                    Haptics.success()
                    return
                }
            }
        }
    }
}
