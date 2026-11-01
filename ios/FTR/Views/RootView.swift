import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var model = model
        Group {
            if model.config == nil && model.categories.isEmpty {
                LaunchView()
            } else {
                TabView(selection: $model.selectedTab) {
                    MenuView()
                        .tabItem { Label("Menu", systemImage: "fork.knife") }
                        .tag(AppModel.Tab.menu)
                    OrdersView()
                        .tabItem { Label("Orders", systemImage: "takeoutbag.and.cup.and.straw") }
                        .tag(AppModel.Tab.orders)
                        .badge(model.orders.filter(\.needsCustomerAction).count)
                    InboxView()
                        .tabItem { Label("Notifications", systemImage: "bell") }
                        .tag(AppModel.Tab.messages)
                        .badge(model.unread)
                    AccountView()
                        .tabItem { Label("Account", systemImage: "person.crop.circle") }
                        .tag(AppModel.Tab.account)
                }
            }
        }
        .fullScreenCover(isPresented: .constant(model.needsAppUpdate)) { UpdateRequiredView() }
        // Signed in but never gave a name (e.g. closed the app mid sign-up): ask once, here.
        .sheet(isPresented: Binding(get: { model.profile?.needsName == true && !model.signInOpen }, set: { _ in })) {
            EditNameView().interactiveDismissDisabled()
        }
        // While the app is open, pick up admin-page changes every 2 minutes
        // (menu items, prices, open dates, Setup switches).
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(120))
                if scenePhase == .active { await model.loadMenu() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // Back in the app: pick up Chef's latest switches (pickup only, half trays,
            // Zelle deposit, open dates, menu) and any new notifications.
            if phase == .active {
                Task {
                    await model.loadMenu()
                    await model.refreshAccountData()
                }
            }
        }
    }
}

/// First launch / no connection yet.
struct LaunchView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            FTRLogo(size: 44)
            Text("Bringing back the OG flavor of Masala Dose")
                .font(Typeface.tagline(18))
                .foregroundStyle(Palette.red)
            if let err = model.loadError {
                Text(err)
                    .font(Typeface.body(16))
                    .foregroundStyle(Palette.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
                Button("Try again") { Task { await model.loadMenu() } }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(maxWidth: 220)
            } else {
                ProgressView().tint(Palette.leaf)
            }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .screenBackground()
    }
}

struct UpdateRequiredView: View {
    var body: some View {
        VStack(spacing: 16) {
            FTRLogo(size: 32)
            Text("Time for an update").font(Typeface.display(28))
            Text("This version of the app can't place orders any more. Please update Franklin Tiffin Room from the App Store.")
                .font(Typeface.body(16))
                .multilineTextAlignment(.center)
                .foregroundStyle(Palette.muted)
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .screenBackground()
        .interactiveDismissDisabled()
    }
}

/// Shows sign-in when needed, otherwise the content.
struct SignedInGate<Content: View>: View {
    @Environment(AppModel.self) private var model
    let reason: String
    @ViewBuilder var content: Content
    @State private var showSignIn = false

    var body: some View {
        Group {
            if model.isSignedIn {
                content
            } else {
                signedOut
            }
        }
        .sheet(isPresented: $showSignIn) { SignInView { showSignIn = false } }
    }

    private var signedOut: some View {
        Group {
            VStack(spacing: 18) {
                FTRLogo(size: 30)
                Text(reason)
                    .font(Typeface.body(17))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 24)
                Button("Sign in with your phone number") { showSignIn = true }
                    .buttonStyle(PrimaryButtonStyle())
                    .padding(.horizontal, 32)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .screenBackground()
        }
    }
}
