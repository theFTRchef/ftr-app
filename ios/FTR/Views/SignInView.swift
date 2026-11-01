import SwiftUI

/// Phone number -> 6-digit text code -> name (first time only).
/// Same identity as WhatsApp: a returning WhatsApp customer is recognised by their number.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var onDone: (() -> Void)?

    private enum Step { case phone, code, name }
    @State private var step: Step = .phone
    @State private var phone = ""
    @State private var code = ""
    @State private var firstName = ""
    @State private var lastName = ""
    @State private var busy = false
    @State private var error: String?
    @State private var resendAt = Date()
    /// How the last code went: "whatsapp" or "sms".
    @State private var sentVia = "sms"
    private var whatsAppOffered: Bool { model.config?.signInByWhatsApp ?? false }
    @FocusState private var focused: Bool

    private let api = APIClient.shared

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    FTRLogo(size: 26).padding(.top, 8)
                    switch step {
                    case .phone: phoneStep
                    case .code: codeStep
                    case .name: nameStep
                    }
                    if let error {
                        Notice(tone: .bad, icon: "exclamationmark.circle", text: error)
                    }
                }
                .padding(20)
            }
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if step != .name { Button("Cancel") { dismiss() } }
                }
            }
            .interactiveDismissDisabled(step == .name)
            .onAppear { focused = true; model.signInOpen = true }
            .onDisappear { model.signInOpen = false }
        }
    }

    // MARK: steps

    private var phoneStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Sign in to order").font(Typeface.display(30))
            Text(whatsAppOffered
                 ? "We'll send a 6-digit code to your mobile on WhatsApp. Already order from us on WhatsApp? Use that number and we'll know it's you."
                 : "We'll text a 6-digit code to your mobile. Already order from us on WhatsApp? Use that number and we'll know it's you.")
                .font(Typeface.body(16)).foregroundStyle(Palette.muted)
            TextField("(908) 555-1234", text: $phone)
                .keyboardType(.phonePad)
                .textContentType(.telephoneNumber)
                .font(Typeface.body(24, weight: .semibold))
                .monospacedDigit()
                .focused($focused)
                .fieldStyle()
                .onChange(of: phone) { _, v in phone = PhoneFormat.us(v) }
            Button {
                Task { await sendCode(via: whatsAppOffered ? "whatsapp" : "sms") }
            } label: {
                busyLabel(whatsAppOffered ? "Send code on WhatsApp" : "Text me a code")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(PhoneFormat.digits(phone).count != 10 || busy)
            if whatsAppOffered {
                Button("Text me a code instead") { Task { await sendCode(via: "sms") } }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(PhoneFormat.digits(phone).count != 10 || busy)
            }
            Text(whatsAppOffered
                 ? "No WhatsApp? We'll send a text instead after 2 minutes. Message and data rates may apply."
                 : "Message and data rates may apply.")
                .font(Typeface.body(13)).foregroundStyle(Palette.muted)
        }
    }

    private var codeStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Enter your code").font(Typeface.display(30))
            Text(sentVia == "whatsapp"
                 ? "Sent on WhatsApp to \(phone). If it doesn't arrive, a text message follows in 2 minutes."
                 : "Sent by text message to \(phone).")
                .font(Typeface.body(16)).foregroundStyle(Palette.muted)
            TextField("123456", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(Typeface.body(30, weight: .bold))
                .monospacedDigit()
                .kerning(6)
                .focused($focused)
                .fieldStyle()
                .onChange(of: code) { _, v in
                    code = String(v.filter(\.isNumber).prefix(6))
                    if code.count == 6 { Task { await verify() } }
                }
            Button { Task { await verify() } } label: { busyLabel("Sign in") }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(code.count != 6 || busy)
            HStack {
                Button("Change number") { step = .phone; code = ""; error = nil }
                Spacer()
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    let wait = Int(resendAt.timeIntervalSince(ctx.date).rounded(.up))
                    Button(wait > 0 ? "Resend in \(wait)s" : (sentVia == "whatsapp" ? "Send by text instead" : "Resend code")) {
                        Task { await sendCode(via: "sms") }
                    }
                    .disabled(wait > 0 || busy)
                }
            }
            .font(Typeface.body(15, weight: .semibold))
        }
    }

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Nice to meet you").font(Typeface.display(30))
            Text("What name should Chef put on your orders?")
                .font(Typeface.body(16)).foregroundStyle(Palette.muted)
            TextField("First name", text: $firstName)
                .textContentType(.givenName).font(Typeface.body(18)).fieldStyle().focused($focused)
            TextField("Last name", text: $lastName)
                .textContentType(.familyName).font(Typeface.body(18)).fieldStyle()
            Button { Task { await saveName() } } label: { busyLabel("Continue") }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(firstName.trimmingCharacters(in: .whitespaces).isEmpty || lastName.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        }
    }

    @ViewBuilder private func busyLabel(_ title: String) -> some View {
        if busy { ProgressView().tint(Palette.leafInk) } else { Text(title) }
    }

    // MARK: actions

    private func sendCode(via: String) async {
        struct B: Encodable { let phone: String; let via: String }
        struct R: Decodable { let via: String? }
        busy = true; error = nil
        defer { busy = false }
        do {
            let r: R = try await api.post("auth/start", B(phone: PhoneFormat.digits(phone), via: via))
            sentVia = r.via ?? via
            step = .code
            code = ""
            resendAt = Date().addingTimeInterval(30)
            focused = true
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    private func verify() async {
        struct B: Encodable { let phone: String; let code: String; let device: String }
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let result: SignInResult = try await api.post("auth/verify", B(phone: PhoneFormat.digits(phone), code: code, device: UIDevice.current.model))
            model.signedIn(result)
            if result.profile.needsName {
                step = .name
                focused = true
            } else {
                finish()
            }
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
            code = ""
        }
    }

    private func saveName() async {
        struct B: Encodable { let firstName: String; let lastName: String }
        busy = true; error = nil
        defer { busy = false }
        do {
            let p: Profile = try await api.put("me", B(firstName: firstName, lastName: lastName))
            model.updateProfile(p)
            finish()
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }

    private func finish() {
        dismiss()
        onDone?()
    }
}

enum PhoneFormat {
    static func digits(_ s: String) -> String {
        var d = s.filter(\.isNumber)
        if d.count == 11, d.hasPrefix("1") { d.removeFirst() }
        return String(d.prefix(10))
    }

    /// "9085551234" -> "(908) 555-1234" while typing.
    static func us(_ s: String) -> String {
        let d = Array(digits(s))
        switch d.count {
        case 0: return ""
        case 1...3: return "(" + String(d)
        case 4...6: return "(" + String(d[0..<3]) + ") " + String(d[3...])
        default: return "(" + String(d[0..<3]) + ") " + String(d[3..<6]) + "-" + String(d[6...])
        }
    }
}

extension View {
    func fieldStyle() -> some View {
        padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line))
    }
}
