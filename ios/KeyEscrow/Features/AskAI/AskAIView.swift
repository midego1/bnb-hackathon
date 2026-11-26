import SwiftUI

struct AskAIView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    @StateObject private var model = AskAIModel()
    @State private var text = ""
    @FocusState private var focused: Bool

    private var suggestions: [(icon: String, text: String)] {
        [("magnifyingglass", "ask.s.find"), ("lock.shield", "ask.s.deposit"), ("arrow.right.circle", "ask.s.next"), ("lightbulb", "ask.s.explain")]
            .map { ($0.0, settings.t($0.1)) }
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        intro
                        ForEach(model.items) { item in bubble(item).id(item.id) }
                        if model.running {
                            HStack(spacing: 10) {
                                avatar
                                ProgressView()
                                Text(settings.t("ask.thinking")).font(.footnote).foregroundStyle(Color.KE.subtle)
                            }
                            .id("running")
                        }
                    }
                    .padding(Metrics.page)
                    .kePage()
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: model.items) { _, items in withAnimation { proxy.scrollTo(model.running ? "running" : items.last?.id, anchor: .bottom) } }
            }
            composer
        }
        .keScreen()
        .navigationTitle(settings.t("tab.ask"))
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { model.newChat() } label: { Image(systemName: "square.and.pencil") }.accessibilityLabel(settings.t("ask.new"))
            }
        }
    }

    // MARK: Intro

    private var intro: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                IconBadge(symbol: "sparkles", size: 44)
                VStack(alignment: .leading, spacing: 8) {
                    Text(settings.t("ask.intro")).font(.subheadline).foregroundStyle(Color.KE.mutedText).fixedSize(horizontal: false, vertical: true)
                    if model.mock { Pill(text: settings.t("ask.demoModel"), tone: .info, icon: "testtube.2") }
                }
            }
            if model.items.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(suggestions, id: \.text) { s in
                        Button { model.send(s.text, address: wallet.address) } label: {
                            HStack(spacing: 6) {
                                Image(systemName: s.icon).foregroundStyle(Color.KE.amber).accessibilityHidden(true)
                                Text(s.text).foregroundStyle(Color.KE.foreground).multilineTextAlignment(.leading)
                            }
                            .font(.subheadline.weight(.medium))
                            .padding(.horizontal, 14).frame(minHeight: 44)
                            .background(Color.KE.surface, in: Capsule())
                            .overlay(Capsule().strokeBorder(Color.KE.borderStrong))
                        }
                        .buttonStyle(PressStyle())
                    }
                }
            }
        }
        .padding(.bottom, 4)
    }

    private var avatar: some View {
        Image(systemName: "sparkles")
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(Color.KE.amber)
            .frame(width: 26, height: 26)
            .background(Color.KE.amberSoft, in: Circle())
            .accessibilityHidden(true)
    }

    // MARK: Messages

    @ViewBuilder private func bubble(_ item: AskAIModel.Item) -> some View {
        switch item {
        case .user(_, let t):
            HStack {
                Spacer(minLength: 48)
                Text(t)
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .foregroundStyle(Color.KE.onPrimary)
                    .background(Color.KE.primary, in: UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 6, topTrailingRadius: 20, style: .continuous))
            }
        case .answer(_, let t):
            HStack(alignment: .top, spacing: 8) {
                avatar
                Text(.init(t))
                    .foregroundStyle(Color.KE.foreground)
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .background(Color.KE.surface, in: UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 20, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous))
                    .overlay(UnevenRoundedRectangle(topLeadingRadius: 6, bottomLeadingRadius: 20, bottomTrailingRadius: 20, topTrailingRadius: 20, style: .continuous).strokeBorder(Color.KE.border))
                Spacer(minLength: 24)
            }
        case .step(_, let label, let state):
            Label {
                Text(label)
            } icon: {
                Image(systemName: state == "done" ? "checkmark.circle.fill" : state == "failed" ? "xmark.circle.fill" : state == "waiting" ? "hand.raised.fill" : "circle.dotted")
                    .foregroundStyle(state == "done" ? Color.KE.success : state == "failed" ? Color.KE.danger : state == "waiting" ? Color.KE.warning : Color.KE.subtle)
            }
            .font(.footnote).foregroundStyle(Color.KE.mutedText)
            .padding(.leading, 34)
        case .card(_, let title, let sub, let hashes):
            Card {
                Text(title).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
                if let sub { Text(sub).font(.subheadline).foregroundStyle(Color.KE.mutedText) }
                if !hashes.isEmpty { DashedRule() }
                ForEach(Array(hashes.enumerated()), id: \.element) { i, h in TxLinkRow(label: settings.t("ask.tx"), hash: h, index: i + 1) }
            }
        case .approval(let a):
            approvalCard(a)
        case .error(_, let t):
            Notice(text: t, tone: .danger)
        }
    }

    /// The exact unsigned steps the assistant prepared; nothing is signed until the renter approves on this phone.
    private func approvalCard(_ a: AskAIModel.Approval) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(settings.t("ask.approval"), systemImage: "signature")
                .font(Font.KE.kicker).textCase(.uppercase).tracking(0.5).foregroundStyle(Color.KE.warning)
            Text(a.title).font(Font.KE.headline).foregroundStyle(Color.KE.foreground)
            Text(a.summary).font(.subheadline).foregroundStyle(Color.KE.mutedText).fixedSize(horizontal: false, vertical: true)
            if !a.steps.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(a.steps.enumerated()), id: \.offset) { i, s in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text("\(i + 1)").font(.caption.weight(.bold)).monospacedDigit().foregroundStyle(Color.KE.warning)
                                .frame(width: 22, height: 22).background(Color.KE.warningSoft, in: Circle())
                            Text(s).font(.footnote).foregroundStyle(Color.KE.foreground).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.KE.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            Label(settings.t("ask.signsWith", EthAddress.short(wallet.address)), systemImage: "wallet.bifold")
                .font(.caption).foregroundStyle(Color.KE.subtle)
            switch a.state {
            case .waiting:
                HStack(spacing: 10) {
                    SecondaryButton(title: settings.t("ask.decline")) { model.answer(a, approve: false, wallet: wallet) }
                    PrimaryButton(title: settings.t("ask.approve"), icon: "checkmark") { model.answer(a, approve: true, wallet: wallet) }
                        .accessibilityIdentifier("ask-approve")
                }
            case .signing: HStack(spacing: 10) { ProgressView(); Text(settings.t("ask.signing")).font(.subheadline).foregroundStyle(Color.KE.mutedText) }.frame(minHeight: 44)
            case .approved: Pill(text: settings.t("ask.approved"), tone: .ok, icon: "checkmark.seal.fill").accessibilityIdentifier("ask-approved")
            case .declined: Pill(text: settings.t("ask.declined"), tone: .neutral, icon: "xmark")
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.KE.surface, in: RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Metrics.radius, style: .continuous).strokeBorder(Color.KE.warning.opacity(0.45), lineWidth: 1.5))
        .shadow(color: Color.KE.shadow.opacity(0.06), radius: 14, x: 0, y: 6)
        .sensoryFeedback(trigger: a.state) { _, new in Self.feedback(for: new) }
    }

    private static func feedback(for state: AskAIModel.Approval.State) -> SensoryFeedback? {
        switch state {
        case .approved: return .success
        case .declined: return .warning
        default: return nil
        }
    }

    // MARK: Composer

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField(settings.t("ask.placeholder"), text: $text, axis: .vertical)
                .lineLimit(1...4)
                .focused($focused)
                .padding(.horizontal, 16).padding(.vertical, 11)
                .background(Color.KE.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Color.KE.borderStrong))
                .submitLabel(.send)
                .accessibilityIdentifier("ask-input")
                .onSubmit(sendText)
            Button(action: sendText) {
                Image(systemName: "arrow.up").font(.headline).foregroundStyle(Color.KE.onPrimary).frame(width: 44, height: 44).background(Color.KE.primary, in: Circle())
            }
            .buttonStyle(PressStyle())
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || model.running)
            .opacity(text.trimmingCharacters(in: .whitespaces).isEmpty || model.running ? 0.4 : 1)
            .accessibilityLabel(settings.t("ask.send"))
            .accessibilityIdentifier("ask-send")
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(.bar)
    }

    private func sendText() {
        guard !model.running else { return } // keep what was typed until the assistant is free again
        model.send(text, address: wallet.address)
        text = ""
        focused = false
    }
}
