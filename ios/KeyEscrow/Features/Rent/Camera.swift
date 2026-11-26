import CryptoKit
import SwiftUI
import UIKit

/// A photo taken for the rental: the JPEG bytes and their SHA-256 (what goes on-chain as a bytes32).
struct CapturedPhoto: Identifiable, Equatable {
    let id = UUID()
    let image: UIImage
    let jpeg: Data
    let sha256: String

    /// The upload limit we aim for: the Worker stores at most 256 KB per file (web/lib/server/evidence/state.ts
    /// STATE_EVIDENCE_MAX_BYTES) and answers 507 above it; 200,000 bytes is the web /r flow's target too
    /// (web/components/stage/photo.ts MAX_PHOTO_BYTES).
    static let maxUploadBytes = 200_000

    /// Long side in pixels and JPEG quality, tried in order until the photo fits. A normal camera photo fits at the
    /// first or second step; the small sizes at the end only matter for pathological images (noise).
    static let ladder: [(side: CGFloat, quality: CGFloat)] = [
        (1280, 0.75), (1280, 0.6), (1280, 0.5), (1280, 0.4),
        (1024, 0.5), (1024, 0.4), (800, 0.5), (800, 0.4),
        (640, 0.4), (512, 0.35), (400, 0.3),
    ]

    /// Resizes and re-encodes until the JPEG is at most `maxUploadBytes`, then hashes those exact bytes (the hash on
    /// chain must be the hash of what is uploaded). Falls back to the smallest encoding if nothing fits.
    init?(image: UIImage) {
        var smallest: (UIImage, Data)?
        for step in Self.ladder {
            let resized = Self.resized(image, longSide: step.side)
            guard let data = resized.jpegData(compressionQuality: step.quality) else { continue }
            if smallest == nil || data.count < smallest!.1.count { smallest = (resized, data) }
            if data.count <= Self.maxUploadBytes { break }
        }
        guard let (img, data) = smallest else { return nil }
        self.image = img
        self.jpeg = data
        self.sha256 = "0x" + SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Draws `image` with its long side at most `longSide` *pixels*. The renderer's scale is pinned to 1: the default
    /// is the screen scale (3x on an iPhone), which would make a "1280 px" photo 3840 px.
    static func resized(_ image: UIImage, longSide: CGFloat) -> UIImage {
        let px = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
        let f = min(1, longSide / max(px.width, px.height))
        let size = CGSize(width: (px.width * f).rounded(), height: (px.height * f).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
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

/// The server refused a photo as too large (HTTP 507 / 413). Worded for the person, in the app's language.
struct PhotoTooLargeError: LocalizedError {
    var errorDescription: String? {
        let zh = (UserDefaults.standard.string(forKey: "lang") ?? (Locale.preferredLanguages.first?.hasPrefix("zh") == true ? "zh" : "en")) == "zh"
        return zh ? "照片太大，服务器无法保存。请重新拍一张。" : "Photo too large for the server. Please take it again."
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
