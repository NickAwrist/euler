import SwiftUI

@main
struct EulerApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var identityStore = IdentityStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(identityStore)
                .environment(appDelegate.push)
                .preferredColorScheme(.dark)
        }
    }
}
