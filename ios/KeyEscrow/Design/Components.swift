import SwiftUI

/// Rounded surface card with a hairline border.
struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.KE.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.KE.border))
    }
}

struct Pill: View {
    let text: String
    var tone: Tone = .neutral
    var icon: String?
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).imageScale(.small) }
            Text(text).lineLimit(1)
        }
        .font(.caption.weight(.semibold))
        .padding(.horizontal, 10).padding(.vertical, 4)
        .foregroundStyle(tone.fg)
        .background(tone.bg, in: Capsule())
    }
}

/// Full-width primary action (44+ pt tall, grows with Dynamic Type).
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
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 12)
            .foregroundStyle(Color.KE.onPrimary)
            .background(Color.KE.primary.opacity(disabled ? 0.4 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
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
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 12)
            .foregroundStyle(Color.KE.foreground)
            .background(Color.KE.surface, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.KE.borderStrong))
        }
        .buttonStyle(.plain)
        .disabled(busy || disabled)
        .opacity(disabled ? 0.5 : 1)
    }
}

struct Notice: View {
    let text: String
    var tone: Tone = .info
    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: tone == .danger ? "exclamationmark.triangle.fill" : tone == .warn ? "exclamationmark.circle.fill" : "info.circle.fill")
            Text(text).frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(.subheadline)
        .foregroundStyle(tone.fg)
        .padding(12)
        .background(tone.bg, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// A "label: value" row; value in monospaced digits.
struct KVRow: View {
    let label: String
    let value: String
    var sub: String?
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(Color.KE.mutedText)
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 2) {
                Text(value).font(.body.weight(.semibold)).monospacedDigit()
                if let sub { Text(sub).font(.caption).foregroundStyle(Color.KE.subtle).monospacedDigit() }
            }
            .multilineTextAlignment(.trailing)
        }
    }
}

/// Opens a transaction on BscScan.
struct TxLinkRow: View {
    let label: String
    let hash: String
    var body: some View {
        Link(destination: Chain.txURL(hash)) {
            HStack {
                Image(systemName: "checkmark.seal.fill").foregroundStyle(Color.KE.success)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.subheadline).foregroundStyle(Color.KE.foreground).multilineTextAlignment(.leading)
                    Text(EthAddress.short(hash)).font(.caption.monospaced()).foregroundStyle(Color.KE.subtle)
                }
                Spacer()
                Image(systemName: "arrow.up.right.square").foregroundStyle(Color.KE.mutedText)
            }
            .frame(minHeight: 44)
        }
        .accessibilityHint("BscScan")
    }
}

/// The scooter / item picture: the server photo when it loads, else a tinted SF Symbol tile.
struct ListingArt: View {
    let url: URL?
    let symbol: String
    var height: CGFloat = 200
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color.KE.night, Color(light: 0x312E81, dark: 0x1E1B4B)], startPoint: .topLeading, endPoint: .bottomTrailing)
            Image(systemName: symbol).font(.system(size: height * 0.36, weight: .semibold)).foregroundStyle(Color.KE.amber).shadow(color: .KE.amber.opacity(0.5), radius: 16)
            if let url {
                AsyncImage(url: url) { phase in
                    if case .success(let img) = phase { img.resizable().scaledToFill() }
                }
            }
        }
        .frame(height: height)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityHidden(true)
    }
}

extension View {
    func keScreen() -> some View { background(Color.KE.background.ignoresSafeArea()) }
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
                .frame(minHeight: 44)
        }
    }
}
