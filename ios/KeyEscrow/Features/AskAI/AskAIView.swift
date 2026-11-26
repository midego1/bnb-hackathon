import SwiftUI

struct AskAIView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var wallet: WalletStore
    @StateObject private var model = AskAIModel()
    @State private var text = ""
    @FocusState private var focused: Bool

    private var suggestions: [String] { ["ask.s.find", "ask.s.deposit", "ask.s.next", "ask.s.explain"].map { settings.t($0) } }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        intro
                        ForEach(model.items) { item in bubble(item).id(item.id) }
                        if model.running { HStack { ProgressView(); Text(settings.t("ask.thinking")).font(.footnote).foregroundStyle(Color.KE.subtle) }.id("running") }
                    }
                    .padding(16)
                }
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

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(settings.t("ask.title"), systemImage: "sparkles").font(.headline)
                if model.mock { Pill(text: settings.t("ask.demoModel"), tone: .info) }
            }
            Text(settings.t("ask.intro")).font(.subheadline).foregroundStyle(Color.KE.mutedText)
            if model.items.isEmpty {
                FlowLayout(spacing: 8) {
                    ForEach(suggestions, id: \.self) { s in
                        Button(s) { model.send(s, address: wallet.address) }
                            .font(.subheadline).padding(.horizontal, 12).frame(minHeight: 44)
                            .background(Color.KE.muted, in: Capsule()).buttonStyle(.plain)
                    }
                }
            }
        }
    }

    @ViewBuilder private func bubble(_ item: AskAIModel.Item) -> some View {
        switch item {
        case .user(_, let t):
            HStack { Spacer(minLength: 40); Text(t).padding(12).foregroundStyle(Color.KE.onPrimary).background(Color.KE.primary, in: RoundedRectangle(cornerRadius: 18)) }
        case .answer(_, let t):
            HStack { Text(.init(t)).padding(12).background(Color.KE.surface, in: RoundedRectangle(cornerRadius: 18)).overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.KE.border)); Spacer(minLength: 40) }
        case .step(_, let label, let state):
            Label(label, systemImage: state == "done" ? "checkmark.circle" : state == "failed" ? "xmark.circle" : state == "waiting" ? "hand.raised" : "circle.dotted")
                .font(.footnote).foregroundStyle(Color.KE.subtle)
        case .card(_, let title, let sub, let hashes):
            Card {
                Text(title).font(.headline)
                if let sub { Text(sub).font(.subheadline).foregroundStyle(Color.KE.mutedText) }
                ForEach(hashes, id: \.self) { TxLinkRow(label: settings.t("ask.tx"), hash: $0) }
            }
        case .approval(let a):
            Card {
                Label(settings.t("ask.approval"), systemImage: "signature").font(.caption.weight(.bold)).foregroundStyle(Color.KE.warning)
                Text(a.title).font(.headline)
                Text(a.summary).font(.subheadline).foregroundStyle(Color.KE.mutedText)
                ForEach(Array(a.steps.enumerated()), id: \.offset) { i, s in Text("\(i + 1). \(s)").font(.footnote) }
                Text(settings.t("ask.signsWith", EthAddress.short(wallet.address))).font(.caption).foregroundStyle(Color.KE.subtle)
                switch a.state {
                case .waiting:
                    HStack {
                        SecondaryButton(title: settings.t("ask.decline")) { model.answer(a, approve: false, wallet: wallet) }
                        PrimaryButton(title: settings.t("ask.approve"), icon: "checkmark") { model.answer(a, approve: true, wallet: wallet) }
                            .accessibilityIdentifier("ask-approve")
                    }
                case .signing: HStack { ProgressView(); Text(settings.t("ask.signing")) }
                case .approved: Pill(text: settings.t("ask.approved"), tone: .ok).accessibilityIdentifier("ask-approved")
                case .declined: Pill(text: settings.t("ask.declined"), tone: .neutral)
                }
            }
        case .error(_, let t):
            Notice(text: t, tone: .danger)
        }
    }

    private var composer: some View {
        HStack(spacing: 8) {
            TextField(settings.t("ask.placeholder"), text: $text, axis: .vertical)
                .lineLimit(1...4)
                .focused($focused)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Color.KE.surface, in: RoundedRectangle(cornerRadius: 22))
                .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Color.KE.borderStrong))
                .submitLabel(.send)
                .accessibilityIdentifier("ask-input")
                .onSubmit(sendText)
            Button(action: sendText) {
                Image(systemName: "arrow.up").font(.headline).foregroundStyle(Color.KE.onPrimary).frame(width: 44, height: 44).background(Color.KE.primary, in: Circle())
            }
            .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || model.running)
            .accessibilityLabel(settings.t("ask.send"))
            .accessibilityIdentifier("ask-send")
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(.bar)
    }

    private func sendText() {
        model.send(text, address: wallet.address)
        text = ""
        focused = false
    }
}

/// Wraps children onto new lines (suggestion chips).
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, w: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > 0, x + sz.width > maxW { x = 0; y += rowH + spacing; rowH = 0 }
            x += sz.width + spacing; rowH = max(rowH, sz.height); w = max(w, x)
        }
        return CGSize(width: min(w, maxW), height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x > bounds.minX, x + sz.width > bounds.maxX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
            x += sz.width + spacing; rowH = max(rowH, sz.height)
        }
    }
}
