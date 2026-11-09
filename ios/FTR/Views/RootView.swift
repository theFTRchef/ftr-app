import SwiftUI

struct RootView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// The welcome screen shows until the customer taps Enter FTR.
    /// (Screenshot runs pass -ftrSkipWelcome to land on Home.)
    @State private var entered = ProcessInfo.processInfo.arguments.contains("-ftrSkipWelcome")

    var body: some View {
        Group {
            if !entered {
                WelcomeView { withAnimation(.easeOut(duration: 0.25)) { entered = true } }
            } else {
                GeometryReader { geo in
                    let wide = WideLayout.isWide(width: geo.size.width, sizeClass: sizeClass)
                    Group {
                        if wide { wideLayout } else { tabLayout }
                    }
                    .environment(\.ftrWide, wide)
                }
            }
        }
        // Tapping a notification goes straight to it.
        .onChange(of: model.openOrderId) { _, id in if id != nil { entered = true } }
        .onChange(of: model.selectedTab) { _, tab in if tab != .menu { entered = true } }
        .fullScreenCover(isPresented: .constant(model.needsAppUpdate)) { UpdateRequiredView() }
        // Signed in but never gave a name (e.g. closed the app mid sign-up): ask once, here.
        .sheet(isPresented: Binding(get: { model.profile?.needsName == true && !model.signInOpen }, set: { _ in })) {
            EditNameView().interactiveDismissDisabled()
        }
        // (Screenshot runs pass -ftrTabAlerts to open on the Alerts tab.)
        .onAppear {
            if ProcessInfo.processInfo.arguments.contains("-ftrTabAlerts") { model.selectedTab = .messages }
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

    /// Phones (and the Duo when closed): the regular bottom tab bar.
    private var tabLayout: some View {
        @Bindable var bindableModel = model
        return TabView(selection: $bindableModel.selectedTab) {
            HomeView()
                .tabItem { Label("Home", systemImage: "house") }
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

    /// Wide screens (Duo open, iPad-size windows): side rail plus the selected screen.
    /// All four screens stay alive so each keeps its place when you switch.
    private var wideLayout: some View {
        HStack(spacing: 0) {
            SideRail()
            ZStack {
                screen(.menu) { HomeView() }
                // Lists and forms read best at about phone-and-a-half width: the whole
                // screen becomes a centered column on a sand background.
                screen(.orders) { column { OrdersView() } }
                screen(.messages) { column { InboxView() } }
                screen(.account) { column { AccountView() } }
            }
        }
        .background(Palette.bg)
    }

    private func column<V: View>(@ViewBuilder _ content: () -> V) -> some View {
        ZStack {
            Palette.bg.ignoresSafeArea()
            content().frame(maxWidth: 720)
        }
    }

    private func screen<V: View>(_ tab: AppModel.Tab, @ViewBuilder _ content: () -> V) -> some View {
        let on = model.selectedTab == tab
        return content()
            .opacity(on ? 1 : 0)
            .allowsHitTesting(on)
            .accessibilityHidden(!on)
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
                    .frame(maxWidth: 460)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .screenBackground()
        }
    }
}
