import SwiftUI
import UIKit

/// The two looks of the app. "Photos" is the default (real photos, the web app's slate tokens). "LED sign" is the
/// marketing page's look (docs/DESIGN.md, web/components/marketing): the interface as a night LED signboard (a board of
/// unlit dots behind every screen, dotted LED frames on cards, amounts in the board's 5x9 LED font); photos stay photos.
enum Design: String, CaseIterable { case photos, led }

/// The active design, read by the colour tokens and the type scale. Set by AppSettings; the root view is rebuilt
/// (`.id(design)`) when it changes, so every token is resolved again.
enum DesignMode {
    static var led = false
}

/// LED palette: the marketing page's night band. Keys are the dark-theme hex of a token, values its LED colour, so
/// every token follows without a third value at each definition (Theme.swift).
enum LEDPalette {
    static let map: [UInt32: UInt32] = [
        0x020617: 0x07061A, // background: night
        0x0F172A: 0x110F33, // surface
        0x1E293B: 0x221F55, // muted, border
        0x334155: 0x3A3580, // border strong
        0xF1F5F9: 0xFFF6DD, // foreground: warm white
        0xB4C0D0: 0xCBC5EE, // muted text
        0x93A1B5: 0x9C95CF, // subtle
        0xF8FAFC: 0xFBBF24, // primary: buttons light up amber
        0x000000: 0x000000,
    ]
    /// On an amber button the text is dark.
    static let onPrimary: UInt32 = 0x1C1917
    static let dotOff = UIColor(hex: 0x1A1745)
    static let panel = UIColor(hex: 0x07061A)
    static let amber = Color(uiColor: UIColor(hex: 0xFBBF24))
    static let pink = Color(uiColor: UIColor(hex: 0xF472B6))
    static let teal = Color(uiColor: UIColor(hex: 0x2DD4BF))
}

// MARK: The LED board behind the interface

/// A field of unlit LEDs: the board the signs are on. Drawn once per size (Canvas), behind screens and tiles.
struct LEDDotGrid: View {
    var spacing: CGFloat = 9
    var dot: CGFloat = 1.8
    var color = Color(uiColor: LEDPalette.dotOff)

    var body: some View {
        Canvas { ctx, size in
            var p = Path()
            var y = spacing / 2
            while y < size.height {
                var x = spacing / 2
                while x < size.width {
                    p.addEllipse(in: CGRect(x: x - dot / 2, y: y - dot / 2, width: dot, height: dot))
                    x += spacing
                }
                y += spacing
            }
            ctx.fill(p, with: .color(color))
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: The LED font of the money board

/// The marketing page's 5x9 LED digits (web/components/marketing/led.ts, the same glyphs): "#" is a lit dot. Digits sit
/// on rows 1 to 7; the baht sign and the comma reach past them.
enum LEDFont {
    static let glyphs: [Character: [String]] = [
        "0": ["", ".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
        "1": ["", "..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
        "2": ["", ".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
        "3": ["", "#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
        "4": ["", "...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
        "5": ["", "#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
        "6": ["", "..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
        "7": ["", "#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
        "8": ["", ".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
        "9": ["", ".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
        ",": ["", "", "", "", "", "", "##", ".#", "#."],
        "฿": ["..#..", "####.", "#.#.#", "#.#.#", "####.", "#.#.#", "#.#.#", "####.", "..#.."],
    ]
    static let rows = 9

    private static func width(_ g: [String]) -> Int { g.map(\.count).max() ?? 0 }

    /// Lit dots of `text` as (column, row), and the width in columns. Characters the font lacks are skipped.
    static func dots(_ text: String) -> (dots: [(Int, Int)], cols: Int) {
        var x = 0
        var out: [(Int, Int)] = []
        for ch in text {
            guard let g = glyphs[ch] else { continue }
            for (y, row) in g.enumerated() {
                for (i, c) in row.enumerated() where c == "#" { out.append((x + i, y)) }
            }
            x += width(g) + 1
        }
        return (out, max(0, x - 1))
    }
}

/// An amount on an LED panel: dotted amber frame, glowing dots, unlit dots behind. Reads as the plain text to VoiceOver.
struct LEDAmount: View {
    let text: String
    var dot: CGFloat = 3.2
    var color = LEDPalette.amber
    var framed = true

    var body: some View {
        let (dots, cols) = LEDFont.dots(text)
        let pitch = dot * 1.45
        let w = CGFloat(cols) * pitch, h = CGFloat(LEDFont.rows) * pitch
        Canvas { ctx, _ in
            var off = Path()
            for x in 0..<cols { for y in 0..<LEDFont.rows { off.addEllipse(in: CGRect(x: CGFloat(x) * pitch, y: CGFloat(y) * pitch, width: dot, height: dot)) } }
            ctx.fill(off, with: .color(Color(uiColor: LEDPalette.dotOff)))
            var on = Path()
            for (x, y) in dots { on.addEllipse(in: CGRect(x: CGFloat(x) * pitch, y: CGFloat(y) * pitch, width: dot, height: dot)) }
            ctx.drawLayer { l in
                l.addFilter(.shadow(color: color.opacity(0.9), radius: dot * 1.1))
                l.fill(on, with: .color(color))
            }
        }
        .frame(width: w, height: h)
        .padding(framed ? dot * 2.6 : 0)
        .background {
            if framed {
                RoundedRectangle(cornerRadius: dot * 1.5)
                    .fill(Color(uiColor: LEDPalette.panel))
                    .overlay(RoundedRectangle(cornerRadius: dot * 1.5)
                        .strokeBorder(color.opacity(0.85), style: StrokeStyle(lineWidth: dot * 0.75, lineCap: .round, dash: [0.1, dot * 1.25])))
                    .shadow(color: color.opacity(0.35), radius: dot * 2)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(text)
    }
}
