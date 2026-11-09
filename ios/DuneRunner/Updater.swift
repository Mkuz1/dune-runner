// Updater.swift — "a new build is out" for the sideloaded iPhone/iPad app.
//
// CI publishes every build of main to the public repo
// Mkuz1/dune-runner-release, next to a small version.json. This
// checks that file at launch (and when the app comes back to the front, at
// most every six hours) and compares its versionCode with our CFBundleVersion.
//
// iOS never lets an app install another app, so "update" means getting the
// new .ipa to whatever re-signs it:
//   • AltStore / SideStore installed → one tap, they download and install it
//   • otherwise → download the .ipa here and open the share sheet, so it can
//     be saved to Files or AirDropped to the Mac running Sideloadly.

import UIKit

final class Updater: NSObject, URLSessionDownloadDelegate {
    static let versionURL = URL(string:
        "https://raw.githubusercontent.com/Mkuz1/dune-runner-release/main/version.json")!

    struct Remote: Decodable {
        let versionCode: Int
        let versionName: String?
        let notes: String?
        let ipa: String
        let ipaSize: Int64?
    }

    private weak var host: UIViewController?
    private var lastCheck: Date?
    private var checking = false
    private var remote: Remote?
    private var session: URLSession?
    private var progress: UIAlertController?

    init(host: UIViewController) {
        self.host = host
        super.init()
    }

    static var currentBuild: Int {
        Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0
    }
    static var currentName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
    }

    func checkIfDue() {
        if let last = lastCheck, Date().timeIntervalSince(last) < 3600 { return }
        check()
    }

    func check() {
        guard !checking, progress == nil else { return }
        checking = true
        lastCheck = Date()
        let req = URLRequest(url: Self.versionURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.checking = false
                guard let data, (response as? HTTPURLResponse)?.statusCode == 200,
                      let r = try? JSONDecoder().decode(Remote.self, from: data),
                      r.versionCode > Self.currentBuild else { return }
                self.offer(r)
            }
        }.resume()
    }

    // MARK: - the prompt

    private func offer(_ r: Remote) {
        guard let host, host.presentedViewController == nil else { return }
        remote = r
        var msg = "Dune Runner \(r.versionName ?? String(r.versionCode)) is available — you have \(Self.currentName)."
        if let n = r.notes, !n.isEmpty { msg += "\n\n\(n)" }
        if let s = r.ipaSize, s > 0 { msg += String(format: "\n\nDownload: %.1f MB", Double(s) / 1_048_576) }

        let a = UIAlertController(title: "Update available", message: msg, preferredStyle: .alert)
        let encoded = r.ipa.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? r.ipa
        for (name, scheme) in [("AltStore", "altstore"), ("SideStore", "sidestore")] {
            if let url = URL(string: "\(scheme)://install?url=\(encoded)"),
               UIApplication.shared.canOpenURL(url) {
                a.addAction(UIAlertAction(title: "Install with \(name)", style: .default) { _ in
                    UIApplication.shared.open(url)
                })
            }
        }
        a.addAction(UIAlertAction(title: "Download .ipa", style: .default) { [weak self] _ in self?.download() })
        a.addAction(UIAlertAction(title: "Later", style: .cancel))
        host.present(a, animated: true)
    }

    // MARK: - download, then hand the file to the share sheet

    private func download() {
        guard let host, let r = remote, let url = URL(string: r.ipa) else { return }
        let p = UIAlertController(title: "Downloading update…", message: "0 %", preferredStyle: .alert)
        p.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.session?.invalidateAndCancel()
            self?.session = nil
            self?.progress = nil
        })
        progress = p
        host.present(p, animated: true)

        let s = URLSession(configuration: .default, delegate: self, delegateQueue: .main)
        session = s
        s.downloadTask(with: url).resume()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : (remote?.ipaSize ?? 0)
        guard total > 0 else { return }
        progress?.message = "\(Int(Double(totalBytesWritten) / Double(total) * 100)) %"
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        // the temporary file is deleted as soon as this returns: move it now
        let name = "DuneRunner-\(remote?.versionName ?? "update").ipa"
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: dest)
        let ok = (try? FileManager.default.moveItem(at: location, to: dest)) != nil
        finish(ok ? dest : nil, error: ok ? nil : "Could not save the downloaded file.")
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error, (error as NSError).code != NSURLErrorCancelled {
            finish(nil, error: error.localizedDescription)
        }
    }

    private func finish(_ file: URL?, error: String?) {
        session?.finishTasksAndInvalidate()
        session = nil
        let shown = progress
        progress = nil
        let next = { [weak self] in
            guard let self, let host = self.host else { return }
            if let file {
                let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                if let pop = share.popoverPresentationController {         // iPad
                    pop.sourceView = host.view
                    pop.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY, width: 1, height: 1)
                    pop.permittedArrowDirections = []
                }
                host.present(share, animated: true)
            } else {
                let a = UIAlertController(title: "Download failed", message: error, preferredStyle: .alert)
                a.addAction(UIAlertAction(title: "OK", style: .default))
                host.present(a, animated: true)
            }
        }
        if let shown, shown.presentingViewController != nil { shown.dismiss(animated: true, completion: next) }
        else { next() }
    }
}
