import CryptoKit
import SwiftUI
import UIKit

/// A photo taken for the rental: the JPEG bytes and their SHA-256 (what goes on-chain as a bytes32).
struct CapturedPhoto: Identifiable, Equatable {
    let id = UUID()
    let image: UIImage
    let jpeg: Data
    let sha256: String

    init?(image: UIImage, maxSide: CGFloat = 1600) {
        let scale = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let data = resized.jpegData(compressionQuality: 0.75) else { return nil }
        self.image = resized
        self.jpeg = data
        self.sha256 = "0x" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    static func == (a: CapturedPhoto, b: CapturedPhoto) -> Bool { a.id == b.id }

    /// The Simulator has no camera: a generated stand-in photo, stamped with the time, clearly labelled.
    static func sample(title: String, kind: String) -> CapturedPhoto? {
        let size = CGSize(width: 1200, height: 900)
        let img = UIGraphicsImageRenderer(size: size).image { ctx in
            UIColor(hex: 0x0D0B2A).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            let cfg = UIImage.SymbolConfiguration(pointSize: 360, weight: .semibold)
            if let s = UIImage(systemName: title.lowercased().contains("box") ? "shippingbox.fill" : "scooter", withConfiguration: cfg)?.withTintColor(UIColor(hex: 0xFBBF24), renderingMode: .alwaysOriginal) {
                s.draw(at: CGPoint(x: (size.width - s.size.width) / 2, y: 140))
            }
            let stamp = "\(kind) · \(ISO8601DateFormatter().string(from: Date()))\nSIMULATOR SAMPLE PHOTO · \(title)"
            let p = NSMutableParagraphStyle(); p.alignment = .center
            (stamp as NSString).draw(in: CGRect(x: 40, y: 740, width: size.width - 80, height: 140), withAttributes: [
                .font: UIFont.monospacedSystemFont(ofSize: 34, weight: .medium), .foregroundColor: UIColor.white, .paragraphStyle: p,
            ])
        }
        return CapturedPhoto(image: img)
    }
}

/// Live camera only (no photo library: the product rule is "no gallery uploads").
struct CameraPicker: UIViewControllerRepresentable {
    let onPhoto: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    static var available: Bool { UIImagePickerController.isSourceTypeAvailable(.camera) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController()
        p.sourceType = .camera
        p.cameraCaptureMode = .photo
        p.delegate = context.coordinator
        return p
    }

    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ p: CameraPicker) { parent = p }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let img = info[.originalImage] as? UIImage { parent.onPhoto(img) }
            parent.dismiss()
        }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}
