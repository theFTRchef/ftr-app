import SwiftUI
import UserNotifications

@main
struct FTRApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model = AppModel()

    init() {
        Typeface.configureAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .tint(Palette.leaf)
                .task {
                    appDelegate.model = model
                    await model.bootstrap()
                }
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    weak var model: AppModel? { didSet { flush() } }
    private var pendingToken: Data?
    private var pendingOpen: String??

    private func flush() {
        guard let m = model else { return }
        if let t = pendingToken { m.didRegister(deviceToken: t); pendingToken = nil }
        if let o = pendingOpen { m.openFromNotification(orderId: o); pendingOpen = nil }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Already allowed earlier? Refresh the device token quietly.
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            if settings.authorizationStatus == .authorized {
                DispatchQueue.main.async { application.registerForRemoteNotifications() }
            }
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in
            if let m = self.model { m.didRegister(deviceToken: deviceToken) } else { self.pendingToken = deviceToken }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        #if DEBUG
        print("Push registration failed:", error.localizedDescription)
        #endif
    }

    // Banner while the app is open, and refresh what's on screen.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        await MainActor.run { Task { await self.model?.refreshAccountData() } }
        return [.banner, .sound, .badge]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let orderId = response.notification.request.content.userInfo["orderId"] as? String
        await MainActor.run {
            if let m = self.model { m.openFromNotification(orderId: orderId) } else { self.pendingOpen = .some(orderId) }
        }
    }
}
