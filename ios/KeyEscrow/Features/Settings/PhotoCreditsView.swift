import SwiftUI

/// Settings > About > Photo credits: every bundled photo with its title, author, licence and source, and what we
/// changed. The same list is in ios/CREDITS.md.
struct PhotoCreditsView: View {
    @EnvironmentObject var settings: AppSettings

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                Text(settings.t("credits.intro")).font(.subheadline).foregroundStyle(Color.KE.mutedText).fixedSize(horizontal: false, vertical: true)
                Notice(text: settings.t("credits.honest"), tone: .info)
                ForEach(PhotoCatalog.credits) { c in card(c) }
                Text(settings.t("credits.sameLicense")).font(.footnote).foregroundStyle(Color.KE.subtle).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, Metrics.page)
            .padding(.top, 8).padding(.bottom, 28)
            .kePage()
        }
        .keScreen()
        .navigationTitle(settings.t("credits.title"))
        .navigationBarTitleDisplayMode(.inline)
    }

    private func use(_ c: PhotoCredit) -> String {
        let s = settings.t(c.use)
        return s
    }

    private func card(_ c: PhotoCredit) -> some View {
        Card(padding: 14, spacing: 10) {
            HStack(alignment: .top, spacing: 14) {
                Group {
                    if let img = PhotoCatalog.thumbnail(c.asset, side: 240) { Image(uiImage: img).resizable().scaledToFill() } else { NightTile() }
                }
                .frame(width: 80, height: 80)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(use(c)).font(Font.KE.kicker).textCase(.uppercase).tracking(0.4).foregroundStyle(Color.KE.amber)
                    Text(c.title).font(.subheadline.weight(.semibold)).foregroundStyle(Color.KE.foreground).fixedSize(horizontal: false, vertical: true)
                    Text(settings.t("credits.by", c.author)).font(.subheadline).foregroundStyle(Color.KE.mutedText)
                }
            }
            .accessibilityElement(children: .combine)
            VStack(alignment: .leading, spacing: 4) {
                Label(settings.t(c.changes), systemImage: "crop").font(.caption).foregroundStyle(Color.KE.mutedText)
                if let n = c.note { Label(settings.t(n), systemImage: "info.circle").font(.caption).foregroundStyle(Color.KE.mutedText) }
            }
            .fixedSize(horizontal: false, vertical: true)
            DashedRule()
            FlowLayout(spacing: 8) {
                if let u = URL(string: c.licenseURL) {
                    Link(destination: u) { chip(c.license, "checkmark.seal") }.accessibilityHint(settings.t("credits.license"))
                }
                if let u = URL(string: c.source) {
                    Link(destination: u) { chip(settings.t("credits.source"), "arrow.up.right") }
                }
            }
        }
    }

    private func chip(_ text: String, _ icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.KE.foreground)
            .padding(.horizontal, 12).frame(minHeight: 44)
            .background(Color.KE.muted, in: Capsule())
    }
}
