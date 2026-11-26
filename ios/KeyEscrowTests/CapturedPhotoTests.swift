import CryptoKit
import UIKit
import XCTest
@testable import KeyEscrow

/// The Worker refuses evidence over 256 KB (HTTP 507); CapturedPhoto must always come in at <= 200,000 bytes.
final class CapturedPhotoTests: XCTestCase {
    /// A full-size iPhone frame (4032x3024) of random noise: the worst case for JPEG.
    private func noiseImage(width: Int = 4032, height: Int = 3024) -> UIImage {
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        arc4random_buf(&bytes, bytes.count)
        let ctx = CGContext(data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        return UIImage(cgImage: ctx.makeImage()!, scale: 1, orientation: .up)
    }

    func testLargeNoisePhotoFitsUnderUploadLimit() throws {
        let p = try XCTUnwrap(CapturedPhoto(image: noiseImage()))
        XCTAssertLessThanOrEqual(p.jpeg.count, 200_000)
        XCTAssertLessThanOrEqual(p.jpeg.count, CapturedPhoto.maxUploadBytes)
        // The hash is of the final bytes, the ones that are uploaded and anchored.
        XCTAssertEqual(p.sha256, "0x" + SHA256.hash(data: p.jpeg).map { String(format: "%02x", $0) }.joined())
        let px = max(p.image.size.width * p.image.scale, p.image.size.height * p.image.scale)
        XCTAssertLessThanOrEqual(px, 1280)
    }

    func testResizeIsInPixelsNotPoints() {
        // A 3x image of 1000x750 points is 3000x2250 pixels; 1280 px long side, whatever the screen scale.
        let r = CapturedPhoto.resized(noiseImage(width: 300, height: 225), longSide: 1280)
        XCTAssertEqual(r.scale, 1)
        let big = UIImage(cgImage: noiseImage(width: 3000, height: 2250).cgImage!, scale: 3, orientation: .up)
        let out = CapturedPhoto.resized(big, longSide: 1280)
        XCTAssertEqual(out.size.width * out.scale, 1280)
        XCTAssertEqual(r.size.width, 300) // never upscaled
    }

    func testSimulatorSamplePhotoFits() throws {
        let p = try XCTUnwrap(CapturedPhoto.sample(title: "Honda PCX 160", kind: "PICKUP"))
        XCTAssertLessThanOrEqual(p.jpeg.count, 200_000)
    }

    func testTooLargeMessageIsClear() {
        XCTAssertFalse((PhotoTooLargeError().errorDescription ?? "").isEmpty)
    }
}
