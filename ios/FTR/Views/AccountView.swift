import SwiftUI

struct AccountView: View {
    @Environment(AppModel.self) private var model
    @State private var showSignIn = false
    @State private var showCustom = false
    @State private var showQuestion = false
    @State private var editingName = false
    @State private var confirmDelete = false
    @State private var deleteError: String?
    @State private var showKitchen = false
    @State private var showFeedback = false

    var body: some View {
        NavigationStack {
            List {
                if model.profile?.isAdmin == true {
                    Section {
                        Button { showKitchen = true } label: {
                            HStack(spacing: 14) {
                                BrandMark(size: 40)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Chef's Kitchen").font(Typeface.display(19, relativeTo: .headline)).foregroundStyle(Palette.ink)
                                    Text("Orders, approvals, menu, calendar and Setup - your admin page")
                                        .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(Palette.muted)
                            }
                            .padding(.vertical, 4)
                        }
                    } footer: {
                        Text("Only shows on Chef's phone. Changes here are the same as on the admin website and the WhatsApp bot.")
                    }
                }
                if let p = model.profile {
                    Section {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(p.firstName) \(p.lastName)").font(Typeface.display(22, relativeTo: .title3))
                            Text(p.phoneDisplay).font(Typeface.body(15)).foregroundStyle(Palette.muted).monospacedDigit()
                        }
                        .padding(.vertical, 4)
                        Button("Edit name") { editingName = true }
                        if let a = p.savedAddress {
                            LabeledContent("Saved address") { Text(a).multilineTextAlignment(.trailing) }
                        }
                    }
                } else {
                    Section {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Order with your phone number").font(Typeface.display(20, relativeTo: .title3))
                            Text("Signing in lets you send orders, follow them and get Chef's replies.")
                                .font(Typeface.body(15)).foregroundStyle(Palette.muted)
                            Button("Sign in") { showSignIn = true }.buttonStyle(PrimaryButtonStyle())
                        }
                        .padding(.vertical, 6)
                    }
                }

                Section("Talk to Chef") {
                    Button { require { showCustom = true } } label: { Label("Request a custom quote", systemImage: "square.and.pencil") }
                    Button { require { showQuestion = true } } label: { Label("Ask a question", systemImage: "questionmark.bubble") }
                    Button { showFeedback = true } label: { Label("Comments & suggestions", systemImage: "text.bubble") }
                    ShareFTRButton()
                    if let dial = model.config?.phoneDial, let url = URL(string: "tel:\(dial)") {
                        Link(destination: url) { Label("Call \(model.config?.phoneDisplay ?? "Chef")", systemImage: "phone") }
                    }
                    let email = model.config?.supportEmail ?? "thechef@franklintiffinroom.com"
                    if let url = URL(string: "mailto:\(email)") {
                        Link(destination: url) { Label(email, systemImage: "envelope") }
                    }
                    if let ig = model.config?.instagram, let url = URL(string: "https://instagram.com/\(ig)") {
                        Link(destination: url) { Label("@\(ig)", systemImage: "camera") }
                    }
                    if let z = model.config?.zelle {
                        Label("Zelle: \(z.to)" + (z.name.map { " (\($0))" } ?? ""), systemImage: "dollarsign.circle")
                            .foregroundStyle(Palette.ink)
                    }
                }

                if let c = model.config {
                    Section("How ordering works") {
                        Text("Chef reviews every order and replies here. \(c.paymentSentence)")
                            .font(Typeface.body(15))
                        if c.cateringPickupOnly {
                            Text("Catering trays are picked up from our kitchen. The LIVE Dose Station comes to you.")
                                .font(Typeface.body(15))
                        }
                    }
                }

                if model.isSignedIn {
                    Section {
                        Button("Sign out") { Task { await model.signOut() } }
                        Button("Delete my account", role: .destructive) { confirmDelete = true }
                    } footer: {
                        Text("Deleting removes your sign-in, saved name, address and messages. Records of orders you placed are kept by Franklin Tiffin Room for its business records.")
                    }
                }

                Section {
                    Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")")
                        .font(Typeface.body(13)).foregroundStyle(Palette.muted)
                }
            }
            .font(Typeface.body(16))
            .scrollContentBackground(.hidden)
            .screenBackground()
            .navigationTitle("Account")
            .sheet(isPresented: $showSignIn) { SignInView() }
            .fullScreenCover(isPresented: $showKitchen) {
                KitchenView()
                    .onDisappear { Task { await model.loadMenu(); await model.refreshAccountData() } }
            }
            .sheet(isPresented: $showCustom) { CustomRequestView() }
            .sheet(isPresented: $showQuestion) { QuestionView() }
            .sheet(isPresented: $showFeedback) { FeedbackView() }
            .sheet(isPresented: $editingName) { EditNameView() }
            .confirmationDialog("Delete your account?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete account", role: .destructive) {
                    Task {
                        do { try await model.deleteAccount() } catch { deleteError = (error as? APIError)?.message ?? error.localizedDescription }
                    }
                }
            } message: {
                Text("You'll be signed out on this phone and your saved details will be removed.")
            }
            .alert("Couldn't delete", isPresented: Binding(get: { deleteError != nil }, set: { if !$0 { deleteError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(deleteError ?? "") }
        }
    }

    private func require(_ then: @escaping () -> Void) {
        if model.isSignedIn { then() } else { showSignIn = true }
    }
}

struct EditNameView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var first = ""
    @State private var last = ""
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("First name", text: $first).textContentType(.givenName)
                TextField("Last name", text: $last).textContentType(.familyName)
                if let error { Text(error).foregroundStyle(Palette.bad) }
            }
            .navigationTitle(model.profile?.needsName == true ? "Add your name" : "Your name")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if model.profile?.needsName != true {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } } }
            }
            .onAppear { first = model.profile?.firstName ?? ""; last = model.profile?.lastName ?? "" }
        }
    }

    private func save() async {
        struct B: Encodable { let firstName: String; let lastName: String }
        do {
            let p: Profile = try await APIClient.shared.put("me", B(firstName: first, lastName: last))
            model.updateProfile(p)
            dismiss()
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}

/// Free-text message to Chef: a custom quote request or a question.
struct ComposeToChefView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let title: String
    let intro: String
    let placeholder: String
    let sendTitle: String
    let send: (String) async throws -> Void

    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @State private var sent = false
    @State private var showSignIn = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(title).font(Typeface.display(28))
                    if sent {
                        Notice(tone: .info, icon: "checkmark.circle", text: "Sent to Chef. You'll get the reply in Notifications.")
                        Button("Done") { dismiss() }.buttonStyle(PrimaryButtonStyle())
                    } else {
                        Text(intro).font(Typeface.body(16)).foregroundStyle(Palette.muted)
                        TextField(placeholder, text: $text, axis: .vertical)
                            .lineLimit(5...12)
                            .font(Typeface.body(16))
                            .fieldStyle()
                        if let error { Notice(tone: .bad, icon: "exclamationmark.circle", text: error) }
                        if !model.isSignedIn {
                            Text("You'll sign in with your phone number so Chef can reply.")
                                .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                        }
                        Button {
                            if !model.isSignedIn { showSignIn = true; return }
                            Task {
                                sending = true
                                defer { sending = false }
                                do { try await send(text); sent = true; await model.refreshAccountData() }
                                catch { self.error = (error as? APIError)?.message ?? error.localizedDescription }
                            }
                        } label: {
                            if sending { ProgressView().tint(Palette.leafInk) } else { Text(sendTitle) }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 || sending)
                    }
                }
                .padding(20)
            }
            .screenBackground()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .sheet(isPresented: $showSignIn) { SignInView { showSignIn = false } }
        }
    }
}

struct CustomRequestView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
            ComposeToChefView(
                title: "Custom quote",
                intro: "Tell Chef the dishes, how many people, the date and time, and pickup or delivery (with the address). Chef replies with a price you can accept here.",
                placeholder: "e.g. North Indian lunch for 60 on Nov 21 - paneer, dal, jeera rice, rotis. Pickup around noon.",
                sendTitle: "Send request"
            ) { text in
                struct B: Encodable { let text: String }
                let _: APIClient.OK = try await APIClient.shared.post("custom-requests", B(text: text))
            }
    }
}

struct QuestionView: View {
    var body: some View {
        ComposeToChefView(
            title: "Ask Chef",
            intro: "Allergies, ingredients, sizes, timing - ask anything. Chef will get back to you.",
            placeholder: "Your question",
            sendTitle: "Send question"
        ) { text in
            struct B: Encodable { let text: String }
            let _: APIClient.OK = try await APIClient.shared.post("questions", B(text: text))
        }
    }
}

// MARK: - Comments & suggestions

struct FeedbackComment: Decodable, Identifiable, Hashable { let id: String; let text: String; let orderId: String?; let at: String? }
struct FeedbackList: Decodable { let comments: [FeedbackComment] }

/// Comments and suggestions for Chef, saved with the customer's phone number,
/// optionally about one of their orders.
struct FeedbackView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var orderId: String? = nil

    @State private var text = ""
    @State private var aboutOrder: String = ""
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?
    @State private var mine: [FeedbackComment] = []
    @State private var showSignIn = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Comments & suggestions").font(Typeface.display(28))
                    if sent {
                        Notice(tone: .info, icon: "checkmark.circle", text: "Thank you! Chef reads every comment.")
                        Button("Done") { dismiss() }.buttonStyle(PrimaryButtonStyle())
                    } else {
                        Text("Tell us how we did, or what you'd like to see next. Chef reads every comment.")
                            .font(Typeface.body(16)).foregroundStyle(Palette.muted)
                        if model.isSignedIn && !model.orders.isEmpty {
                            Picker("About an order", selection: $aboutOrder) {
                                Text("Not about a specific order").tag("")
                                ForEach(model.orders.filter { $0.stage != .closed || $0.orderId == orderId }) { o in
                                    Text("\(o.orderId) · \(o.title)").tag(o.orderId)
                                }
                            }
                            .pickerStyle(.menu)
                            .tint(Palette.leaf)
                        }
                        TextField("Your comment or idea", text: $text, axis: .vertical)
                            .lineLimit(4...12)
                            .font(Typeface.body(16))
                            .fieldStyle()
                        if let error { Notice(tone: .bad, icon: "exclamationmark.circle", text: error) }
                        if !model.isSignedIn {
                            Text("You'll sign in with your phone number so we can keep your comments together.")
                                .font(Typeface.body(14)).foregroundStyle(Palette.muted)
                        }
                        Button {
                            if !model.isSignedIn { showSignIn = true; return }
                            Task { await send() }
                        } label: {
                            if sending { ProgressView().tint(Palette.leafInk) } else { Text("Send comment") }
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 || sending)
                    }
                    if !mine.isEmpty {
                        Text("Your earlier comments").font(Typeface.display(20, relativeTo: .title3)).padding(.top, 8)
                        ForEach(mine) { c in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(c.text).font(Typeface.body(15))
                                HStack {
                                    if let d = c.at.flatMap(ISO8601.parse) { Text(d, format: .dateTime.month(.abbreviated).day().year()) }
                                    if let o = c.orderId { Text("· \(o)") }
                                }
                                .font(Typeface.body(13)).foregroundStyle(Palette.muted)
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Palette.line))
                        }
                    }
                }
                .padding(20)
            }
            .screenBackground()
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .sheet(isPresented: $showSignIn) { SignInView { showSignIn = false } }
            .task {
                aboutOrder = orderId ?? ""
                await loadMine()
            }
        }
    }

    private func loadMine() async {
        guard model.isSignedIn else { return }
        if let r = try? await (APIClient.shared.get("feedback") as FeedbackList) { mine = r.comments }
    }

    private func send() async {
        struct B: Encodable { let text: String; let orderId: String? }
        sending = true
        error = nil
        defer { sending = false }
        do {
            let c: FeedbackComment = try await APIClient.shared.post("feedback", B(text: text, orderId: aboutOrder.isEmpty ? nil : aboutOrder))
            mine.insert(c, at: 0)
            sent = true
        } catch {
            self.error = (error as? APIError)?.message ?? error.localizedDescription
        }
    }
}
