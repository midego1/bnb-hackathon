import SwiftUI

// MARK: Surfaces

/// Rounded surface card: hairline border, soft shadow in the light theme.
struct Card<Content: View>: View {
    var padding: CGFloat = 18
    var spacing: CGFloat = 12
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .keSurface()
    }
}

extension View {
    /// The card look on any view: surface fill, continuous corners, hairline, soft shadow.
    func keSurface(radius: CGFloat = Metrics.radius, fill: Color = .KE.surface) -> some View {
        background(fill, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(Color.KE.border))
            .shadow(color: Color.KE.shadow.opacity(0.06), radius: 14, x: 0, y: 6)
    }

    func keScreen() -> some View { background(Color.KE.background.ignoresSafeArea()) }

    /// Page column: the phone layout, centred on wider screens.
    func kePage() -> some View {
        frame(maxWidth: Metrics.maxWidth, alignment: .leading).frame(maxWidth: .infinity)
    }
}

/// Rounded-square SF Symbol tile (step cards, settings rows, timeline).
struct IconBadge: View {
    let symbol: String
    var tint: Color = .KE.amber
    var fill: Color = .KE.amberSoft
    var size: CGFloat = 40
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.44, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(fill, in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityHidden(true)
    }
}

struct Pill: View {
    let text: String
    var tone: Tone = .neutral
    var icon: String?
    /// On a photo: a solid surface chip instead of the soft tint.
    var solid = false
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).imageScale(.small).accessibilityHidden(true) }
            Text(text).lineLimit(1)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 10).padding(.vertical, 5)
        .foregroundStyle(solid && tone == .neutral ? Color.KE.foreground : tone.fg)
        .background(solid ? Color.KE.surface : tone.bg, in: Capsule())
        .shadow(color: solid ? Color.black.opacity(0.18) : .clear, radius: 6, y: 2)
    }
}

/// "Live on stage" with a dot that breathes (still under Reduce Motion).
struct LivePill: View {
    let text: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var on = false
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(Color.KE.success).frame(width: 8, height: 8)
                .overlay(Circle().stroke(Color.KE.success.opacity(0.5), lineWidth: 2).scaleEffect(on ? 2.2 : 1).opacity(on ? 0 : 1))
                .accessibilityHidden(true)
            Text(text).lineLimit(1)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 10).padding(.vertical, 5)
        .foregroundStyle(Color.KE.success)
        .background(Color.KE.surface, in: Capsule())
        .shadow(color: Color.black.opacity(0.18), radius: 6, y: 2)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { on = true }
        }
    }
}

// MARK: Buttons

/// Press feedback shared by the app's buttons: a small dip, opacity only under Reduce Motion.
struct PressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

/// Full-width primary action (52+ pt tall, grows with Dynamic Type).
struct PrimaryButton: View {
    let title: String
    var icon: String?
    var busy = false
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(Color.KE.onPrimary) } else if let icon { Image(systemName: icon) }
                Text(title).multilineTextAlignment(.center)
            }
            .font(Font.KE.headline)
            .frame(maxWidth: .infinity, minHeight: 54)
            .padding(.horizontal, 14)
            .foregroundStyle(Color.KE.onPrimary)
            .background(Color.KE.primary.opacity(disabled ? 0.35 : 1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(PressStyle())
        .disabled(busy || disabled)
    }
}

struct SecondaryButton: View {
    let title: String
    var icon: String?
    var busy = false
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView() } else if let icon { Image(systemName: icon) }
                Text(title).multilineTextAlignment(.center)
            }
            .font(Font.KE.headline)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 14)
            .foregroundStyle(Color.KE.foreground)
            .background(Color.KE.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.KE.borderStrong))
        }
        .buttonStyle(PressStyle())
        .disabled(busy || disabled)
        .opacity(disabled ? 0.5 : 1)
    }
}

/// The look of PrimaryButton for a NavigationLink label.
struct PrimaryLabel: View {
    let title: String
    var icon: String?
    var fullWidth = true
    var body: some View {
        HStack(spacing: 8) {
            if let icon { Image(systemName: icon) }
            Text(title).multilineTextAlignment(.center)
        }
        .font(Font.KE.headline)
        .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: 54)
        .padding(.horizontal, fullWidth ? 14 : 26)
        .foregroundStyle(Color.KE.onPrimary)
        .background(Color.KE.primary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: Text blocks

struct Notice: View {
    let text: String
    var tone: Tone = .info
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tone == .danger ? "exclamationmark.triangle.fill" : tone == .warn ? "exclamationmark.circle.fill" : tone == .ok ? "checkmark.circle.fill" : "info.circle.fill")
            Text(text).frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.subheadline)
        .foregroundStyle(tone.fg)
        .padding(14)
        .background(tone.bg, in: RoundedRectangle(cornerRadius: Metrics.radiusSmall, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radiusSmall, style: .continuous).strokeBorder(tone.fg.opacity(0.18)))
        .accessibilityElement(children: .combine)
    }
}

/// Section title with an optional line under it.
struct SectionHeader: View {
    let title: String
    var subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(Font.KE.section).foregroundStyle(Color.KE.foreground)
            if let subtitle { Text(subtitle).font(.subheadline).foregroundStyle(Color.KE.mutedText) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A "label: value" row; value in monospaced digits.
struct KVRow: View {
    let label: String
    let value: String
    var sub: String?
    var strong = false
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(strong ? .body.weight(.semibold) : .body).foregroundStyle(strong ? Color.KE.foreground : Color.KE.mutedText)
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 2) {
                Text(value).font(strong ? Font.KE.amountSmall : .body.weight(.semibold)).monospacedDigit().foregroundStyle(Color.KE.foreground)
                if let sub { Text(sub).font(.caption).foregroundStyle(Color.KE.subtle).monospacedDigit() }
            }
            .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The dashed rule of a paper receipt.
struct DashedRule: View {
    var body: some View {
        Line().stroke(Color.KE.borderStrong, style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [2, 5]))
            .frame(height: 1)
            .accessibilityHidden(true)
    }
    private struct Line: Shape {
        func path(in rect: CGRect) -> Path { Path { $0.move(to: CGPoint(x: rect.minX, y: rect.midY)); $0.addLine(to: CGPoint(x: rect.maxX, y: rect.midY)) } }
    }
}

/// Opens a transaction on BscScan.
struct TxLinkRow: View {
    let label: String
    let hash: String
    var index: Int?
    var body: some View {
        Link(destination: Chain.txURL(hash)) {
            HStack(alignment: .center, spacing: 12) {
                ZStack {
                    Circle().fill(Color.KE.successSoft)
                    if let index { Text("\(index)").font(.caption.weight(.bold)).monospacedDigit().foregroundStyle(Color.KE.success) }
                    else { Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(Color.KE.success) }
                }
                .frame(width: 26, height: 26)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.subheadline).foregroundStyle(Color.KE.foreground).multilineTextAlignment(.leading)
                    Text(EthAddress.short(hash)).font(Font.KE.monoSmall).foregroundStyle(Color.KE.subtle)
                }
                Spacer(minLength: 8)
                Image(systemName: "arrow.up.right").font(.footnote.weight(.semibold)).foregroundStyle(Color.KE.mutedText)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .accessibilityHint("BscScan")
    }
}

/// A paper receipt: surface with a sawtooth bottom edge.
struct ReceiptCard<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(18).padding(.bottom, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ReceiptShape().fill(Color.KE.surface))
            .overlay(ReceiptShape().stroke(Color.KE.border, lineWidth: 1))
            .shadow(color: Color.KE.shadow.opacity(0.06), radius: 14, x: 0, y: 6)
    }
}

struct ReceiptShape: Shape {
    var radius: CGFloat = 18
    var tooth: CGFloat = 7
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.minX, y: rect.maxY - tooth))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        p.addArc(center: CGPoint(x: rect.minX + radius, y: rect.minY + radius), radius: radius, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        p.addArc(center: CGPoint(x: rect.maxX - radius, y: rect.minY + radius), radius: radius, startAngle: .degrees(270), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - tooth))
        let count = max(8, Int((rect.width / (tooth * 2)).rounded()))
        let w = rect.width / CGFloat(count)
        for i in 0..<count {
            let x = rect.maxX - CGFloat(i) * w
            p.addLine(to: CGPoint(x: x - w / 2, y: rect.maxY))
            p.addLine(to: CGPoint(x: x - w, y: rect.maxY - tooth))
        }
        p.closeSubpath()
        return p
    }
}

// MARK: Progress and state

/// One part of a split bar.
struct SplitPart: Identifiable {
    let id: String
    let label: String
    let value: Double
    let color: Color
    let detail: String
}

/// How an amount was divided: one bar, parts in proportion, each named with its amount underneath.
struct SplitBar: View {
    let parts: [SplitPart]
    var body: some View {
        let shown = parts.filter { $0.value > 0 }
        let total = max(shown.reduce(0) { $0 + $1.value }, 0.000_001)
        VStack(alignment: .leading, spacing: 10) {
            GeometryReader { geo in
                HStack(spacing: 2) {
                    ForEach(shown) { p in
                        p.color.frame(width: max(4, (geo.size.width - CGFloat(max(0, shown.count - 1)) * 2) * p.value / total))
                    }
                }
                .clipShape(Capsule())
            }
            .frame(height: 10)
            .accessibilityHidden(true)
            FlowLayout(spacing: 14) {
                ForEach(shown) { p in
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 3).fill(p.color).frame(width: 10, height: 10)
                        Text(p.label).foregroundStyle(Color.KE.mutedText)
                        Text(p.detail).fontWeight(.semibold).monospacedDigit().foregroundStyle(Color.KE.foreground)
                    }
                    .font(.caption)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// The settled check: the ring draws, then the tick. Drawn at once under Reduce Motion.
struct SuccessCheck: View {
    var size: CGFloat = 76
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ring = false
    @State private var tick = false
    var body: some View {
        ZStack {
            Circle().fill(Color.KE.successSoft)
            Circle().trim(from: 0, to: ring ? 1 : 0)
                .stroke(Color.KE.success, style: StrokeStyle(lineWidth: size * 0.06, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .padding(size * 0.03)
            Tick().trim(from: 0, to: tick ? 1 : 0)
                .stroke(Color.KE.success, style: StrokeStyle(lineWidth: size * 0.085, lineCap: .round, lineJoin: .round))
                .padding(size * 0.29)
        }
        .frame(width: size, height: size)
        .scaleEffect(tick || reduceMotion ? 1 : 0.86)
        .accessibilityHidden(true)
        .onAppear {
            if reduceMotion { ring = true; tick = true; return }
            withAnimation(.easeOut(duration: 0.45)) { ring = true }
            withAnimation(.spring(response: 0.42, dampingFraction: 0.62).delay(0.35)) { tick = true }
        }
    }
    private struct Tick: Shape {
        func path(in r: CGRect) -> Path {
            Path {
                $0.move(to: CGPoint(x: r.minX, y: r.minY + r.height * 0.55))
                $0.addLine(to: CGPoint(x: r.minX + r.width * 0.38, y: r.maxY - r.height * 0.08))
                $0.addLine(to: CGPoint(x: r.maxX, y: r.minY + r.height * 0.12))
            }
        }
    }
}

/// Copy to the pasteboard with a short "Copied" confirmation.
struct CopyButton: View {
    let text: String
    let label: String
    @State private var copied = false
    @EnvironmentObject var settings: AppSettings
    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied = true
            Task { try? await Task.sleep(nanoseconds: 1_500_000_000); copied = false }
        } label: {
            Label(copied ? settings.t("common.copied") : label, systemImage: copied ? "checkmark" : "doc.on.doc")
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        }
        .sensoryFeedback(.success, trigger: copied) { _, now in now }
    }
}

// MARK: Layout

/// Wraps children onto new lines (chips, badges, legends).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, w: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(ProposedViewSize(width: maxW, height: nil))
            if x > 0, x + sz.width > maxW { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height); w = max(w, x - spacing)
        }
        return CGSize(width: min(w, maxW), height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX, x + sz.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}
