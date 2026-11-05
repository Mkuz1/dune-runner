// AppDelegate.swift — Dune Runner for iPhone and iPad.
//
// A plain UIKit host for the web game, the iOS twin of the Android app's
// MainActivity. The game itself is not copied into this folder: the Xcode
// project bundles ../app/src/main/assets/game directly, so Android, iOS and
// the website always ship exactly the same build.

import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = .black
        window.rootViewController = GameViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
