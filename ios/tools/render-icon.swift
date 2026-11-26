// Renders the KeyScrow app icon (neon key-shield over a Bangkok night street) with CoreGraphics.
// Usage, from ios/: swift tools/render-icon.swift <out.png> default|dark|tinted
// Writes 1024x1024 PNGs; the three variants live in KeyEscrow/Resources/Assets.xcassets/AppIcon.appiconset.
import AppKit
import CoreGraphics

// KeyScrow app icon: a neon key-shield over a night soi. Variants: default, dark, tinted.
let variant = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "default"
let N = 1024
let W = CGFloat(N)
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: N, height: N, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                    bitmapInfo: (variant == "tinted" ? CGImageAlphaInfo.premultipliedLast : CGImageAlphaInfo.noneSkipLast).rawValue)!
func c(_ hex: UInt32, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: a)
}
// Flip to a top-left origin so the geometry below reads top-down.
ctx.translateBy(x: 0, y: W); ctx.scaleBy(x: 1, y: -1)

let tinted = variant == "tinted"
let dark = variant == "dark"
let amber = tinted ? c(0xFFFFFF) : c(0xFBBF24)
let amberHot = tinted ? c(0xFFFFFF) : c(0xFFF3C4)
let amberDeep = tinted ? c(0xBBBBBB) : c(0xF59E0B)

// 1. Night sky: indigo, lighter toward the horizon glow behind the shield.
if tinted {
    ctx.setFillColor(c(0x000000, 0)); ctx.fill(CGRect(x: 0, y: 0, width: W, height: W))
} else {
    let top = dark ? c(0x05041A) : c(0x0D0B2A)
    let mid = dark ? c(0x1A1650) : c(0x2A2470)
    let bottom = dark ? c(0x0A0826) : c(0x15123F)
    let g = CGGradient(colorsSpace: cs, colors: [top, mid, bottom] as CFArray, locations: [0, 0.62, 1])!
    ctx.drawLinearGradient(g, start: CGPoint(x: W / 2, y: 0), end: CGPoint(x: W / 2, y: W), options: [])

    // Soft magenta / teal neon haze from the street signs, left and right.
    for (x, y, r, col) in [(140.0, 700.0, 420.0, c(0xEC4899, 0.22)), (900.0, 640.0, 420.0, c(0x14B8A6, 0.18)), (512.0, 470.0, 520.0, c(0xFBBF24, 0.20))] {
        let rg = CGGradient(colorsSpace: cs, colors: [col, c(0x000000, 0)] as CFArray, locations: [0, 1])!
        ctx.drawRadialGradient(rg, startCenter: CGPoint(x: x, y: y), startRadius: 0, endCenter: CGPoint(x: x, y: y), endRadius: r, options: [])
    }

    // A few stars.
    var seed: UInt64 = 7
    func rnd() -> CGFloat { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat((seed >> 33) % 10_000) / 10_000 }
    for _ in 0..<38 {
        let p = CGPoint(x: rnd() * W, y: rnd() * 330)
        let s = 1.5 + rnd() * 3
        ctx.setFillColor(c(0xFFFFFF, 0.25 + rnd() * 0.5))
        ctx.fillEllipse(in: CGRect(x: p.x, y: p.y, width: s, height: s))
    }

    // 2. Skyline: shophouses and towers in silhouette, a few windows lit (amber, pink, teal), then a wet street.
    let horizon: CGFloat = 800
    var bseed: UInt64 = 42
    func brnd() -> CGFloat { bseed = bseed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat((bseed >> 33) % 10_000) / 10_000 }
    // Far layer (taller towers, lighter), then near layer (low shophouses, darker).
    for layer in 0..<2 {
        var x: CGFloat = -20
        let col = layer == 0 ? c(dark ? 0x120F38 : 0x1B1750) : c(dark ? 0x07051A : 0x0C0A2A)
        while x < W + 20 {
            let w: CGFloat = layer == 0 ? 60 + brnd() * 70 : 70 + brnd() * 80
            let h: CGFloat = layer == 0 ? 220 + brnd() * 260 : 110 + brnd() * 120
            let r = CGRect(x: x, y: horizon - h, width: w, height: h + 2)
            ctx.setFillColor(col); ctx.fill(r)
            if layer == 0, brnd() > 0.6 { // antenna
                ctx.fill(CGRect(x: x + w / 2 - 2, y: horizon - h - 40, width: 4, height: 40))
            }
            // Windows.
            var wy = horizon - h + 18
            while wy < horizon - 16 {
                var wx = x + 10
                while wx < x + w - 14 {
                    let v = brnd()
                    if v > (layer == 0 ? 0.72 : 0.62) {
                        let wc: CGColor = v > 0.97 ? c(0xEC4899, 0.9) : v > 0.94 ? c(0x2DD4BF, 0.85) : c(0xFBBF24, layer == 0 ? 0.45 : 0.75)
                        ctx.saveGState(); ctx.setShadow(offset: .zero, blur: 6, color: wc)
                        ctx.setFillColor(wc); ctx.fill(CGRect(x: wx, y: wy, width: 9, height: 12))
                        ctx.restoreGState()
                    }
                    wx += 18
                }
                wy += 24
            }
            x += w + (layer == 0 ? 6 : 2)
        }
    }
    // Wet street below the horizon: dark, with a faint sheen.
    let street = CGGradient(colorsSpace: cs, colors: [c(dark ? 0x0A0826 : 0x141046), c(dark ? 0x020110 : 0x07051C)] as CFArray, locations: [0, 1])!
    ctx.saveGState(); ctx.clip(to: CGRect(x: 0, y: horizon, width: W, height: W - horizon))
    ctx.drawLinearGradient(street, start: CGPoint(x: 0, y: horizon), end: CGPoint(x: 0, y: W), options: [])
    ctx.restoreGState()
    // Neon pools on the street from the signs.
    for (x, col) in [(180.0, c(0xEC4899, 0.35)), (512.0, c(0xFBBF24, 0.55)), (850.0, c(0x2DD4BF, 0.3))] {
        ctx.saveGState()
        ctx.translateBy(x: x, y: horizon + 70); ctx.scaleBy(x: 1, y: 0.22)
        let rg = CGGradient(colorsSpace: cs, colors: [col, c(0x000000, 0)] as CFArray, locations: [0, 1])!
        ctx.drawRadialGradient(rg, startCenter: .zero, startRadius: 0, endCenter: .zero, endRadius: x == 512 ? 380 : 220, options: [])
        ctx.restoreGState()
    }
}

// 3. The shield.
let cx = W / 2
let top: CGFloat = 150, shoulder: CGFloat = 222, sideBottom: CGFloat = 560, tip: CGFloat = 790
let halfW: CGFloat = 282
func shieldPath(inset d: CGFloat) -> CGPath {
    let p = CGMutablePath()
    let hw = halfW - d
    p.move(to: CGPoint(x: cx, y: top + d))
    p.addCurve(to: CGPoint(x: cx + hw, y: shoulder + d * 0.6), control1: CGPoint(x: cx + hw * 0.45, y: top + d + 46), control2: CGPoint(x: cx + hw * 0.8, y: shoulder + d * 0.6 - 10))
    p.addCurve(to: CGPoint(x: cx, y: tip - d * 1.25), control1: CGPoint(x: cx + hw, y: sideBottom), control2: CGPoint(x: cx + hw * 0.55, y: tip - 120 - d))
    p.addCurve(to: CGPoint(x: cx - hw, y: shoulder + d * 0.6), control1: CGPoint(x: cx - hw * 0.55, y: tip - 120 - d), control2: CGPoint(x: cx - hw, y: sideBottom))
    p.addCurve(to: CGPoint(x: cx, y: top + d), control1: CGPoint(x: cx - hw * 0.8, y: shoulder + d * 0.6 - 10), control2: CGPoint(x: cx - hw * 0.45, y: top + d + 46))
    p.closeSubpath()
    return p
}

if !tinted {
    // Glassy dark fill inside the shield so the neon reads like a lit sign on a dark panel.
    ctx.saveGState()
    ctx.addPath(shieldPath(inset: 0)); ctx.clip()
    let fill = CGGradient(colorsSpace: cs, colors: [c(0x1E1B4B, 0.97), c(0x0B0A24, 0.99)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(fill, start: CGPoint(x: cx, y: top), end: CGPoint(x: cx, y: tip), options: [])
    // Glass highlight across the upper left.
    let hl = CGMutablePath()
    hl.move(to: CGPoint(x: cx - halfW, y: top)); hl.addLine(to: CGPoint(x: cx + 40, y: top)); hl.addLine(to: CGPoint(x: cx - halfW, y: 470)); hl.closeSubpath()
    ctx.addPath(hl); ctx.setFillColor(c(0xFFFFFF, 0.05)); ctx.fillPath()
    ctx.restoreGState()
}

/// A neon tube: wide soft glow, a tighter glow, the coloured tube, a hot white core.
func neon(_ path: CGPath, width: CGFloat) {
    ctx.setLineCap(.round); ctx.setLineJoin(.round)
    if !tinted {
        for (blur, a, w) in [(90.0, 0.55, width * 1.6), (40.0, 0.8, width * 1.2), (16.0, 1.0, width)] {
            ctx.saveGState()
            ctx.setShadow(offset: .zero, blur: blur, color: c(0xF59E0B, a))
            ctx.addPath(path); ctx.setStrokeColor(amberDeep); ctx.setLineWidth(w); ctx.strokePath()
            ctx.restoreGState()
        }
    }
    ctx.addPath(path); ctx.setStrokeColor(amber); ctx.setLineWidth(width); ctx.strokePath()
    ctx.addPath(path); ctx.setStrokeColor(amberHot); ctx.setLineWidth(width * 0.38); ctx.strokePath()
}

neon(shieldPath(inset: 0), width: 30)

// 4. The key inside: round bow (a ring), a shaft down, two teeth.
let bowC = CGPoint(x: cx, y: 372), bowR: CGFloat = 82
let key = CGMutablePath()
key.addEllipse(in: CGRect(x: bowC.x - bowR, y: bowC.y - bowR, width: bowR * 2, height: bowR * 2))
let shaftTop = bowC.y + bowR, shaftBottom: CGFloat = 650
key.move(to: CGPoint(x: cx, y: shaftTop)); key.addLine(to: CGPoint(x: cx, y: shaftBottom))
key.move(to: CGPoint(x: cx, y: shaftBottom - 4)); key.addLine(to: CGPoint(x: cx + 62, y: shaftBottom - 4))
key.move(to: CGPoint(x: cx, y: shaftBottom - 66)); key.addLine(to: CGPoint(x: cx + 44, y: shaftBottom - 66))
neon(key, width: 26)

// The neon reflected on the wet street (flipped about the shield's tip, faded, rippled).
if !tinted {
    ctx.saveGState()
    ctx.clip(to: CGRect(x: 0, y: tip + 6, width: W, height: W - tip))
    ctx.setAlpha(0.22)
    ctx.translateBy(x: 0, y: 2 * tip + 12); ctx.scaleBy(x: 1, y: -1)
    neon(shieldPath(inset: 0), width: 30)
    neon(key, width: 26)
    ctx.restoreGState()
    // Ripples: thin dark lines across the reflection.
    ctx.setFillColor(c(0x07051C, 0.55))
    var y = tip + 22
    while y < W { ctx.fill(CGRect(x: 0, y: y, width: W, height: 3)); y += 14 }
    // The reflection fades out with distance: the street colour closes in toward the bottom edge.
    let fade = CGGradient(colorsSpace: cs, colors: [c(dark ? 0x05041A : 0x0C0A2E, 0), c(dark ? 0x020110 : 0x07051C, 0.75), c(dark ? 0x020110 : 0x07051C, 1)] as CFArray, locations: [0, 0.55, 1])!
    ctx.drawLinearGradient(fade, start: CGPoint(x: 0, y: tip + 6), end: CGPoint(x: 0, y: W), options: [])
}

// A small sparkle on the bow: the "it's safe" glint.
if !tinted {
    let sp = CGPoint(x: bowC.x + 52, y: bowC.y - 56)
    ctx.saveGState()
    ctx.setShadow(offset: .zero, blur: 24, color: c(0xFFFFFF, 0.9))
    let star = CGMutablePath()
    for i in 0..<8 {
        let a = CGFloat(i) * .pi / 4
        let r: CGFloat = i % 2 == 0 ? 30 : 7
        let pt = CGPoint(x: sp.x + cos(a) * r, y: sp.y + sin(a) * r)
        i == 0 ? star.move(to: pt) : star.addLine(to: pt)
    }
    star.closeSubpath()
    ctx.addPath(star); ctx.setFillColor(c(0xFFFBEB)); ctx.fillPath()
    ctx.restoreGState()
}

let img = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: img)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
