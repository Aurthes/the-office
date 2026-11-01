import AppKit

// A small native owner for the bundled runtime; the existing browser UI is reused.
final class OfficeDelegate: NSObject, NSApplicationDelegate {
    private var runtime: Process?
    private var officeURL: URL?
    private var buffer = ""
    private var quitting = false
    private var failed = false
    private let openItem = NSMenuItem(title: "Opening Office…", action: #selector(openOffice), keyEquivalent: "o")

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let application = NSMenuItem()
        let items = NSMenu()
        openItem.target = self
        openItem.isEnabled = false
        items.addItem(openItem)
        items.addItem(.separator())
        items.addItem(withTitle: "Quit Office", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        application.submenu = items
        menu.addItem(application)
        NSApp.mainMenu = menu

        guard let resources = Bundle.main.resourceURL else { showError("Office's files could not be found. Reinstall the application."); return }
        let process = Process()
        process.executableURL = resources.appendingPathComponent("node/bin/node")
        process.arguments = [resources.appendingPathComponent("office/desktop/launcher.cjs").path]
        process.arguments?.append(contentsOf: ["--parent-pid", String(ProcessInfo.processInfo.processIdentifier)])
        if let index = CommandLine.arguments.firstIndex(of: "--data-dir"), index + 1 < CommandLine.arguments.count {
            process.arguments?.append(contentsOf: ["--data-dir", CommandLine.arguments[index + 1]])
        }
        process.currentDirectoryURL = resources.appendingPathComponent("office")
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            guard let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.receive(text) }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if self.quitting { NSApp.reply(toApplicationShouldTerminate: true) }
                else if !self.failed { self.showError("Office stopped. Your saved conversations are kept. Reopen Office to continue.") }
            }
        }
        runtime = process
        do { try process.run() }
        catch { showError("Office could not start its bundled runtime. Reinstall the complete application.") }
    }

    private func receive(_ text: String) {
        buffer += text
        while let end = buffer.firstIndex(of: "\n") {
            let line = String(buffer[..<end])
            buffer.removeSubrange(...end)
            guard let data = line.data(using: .utf8),
                  let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            if value["phase"] as? String == "ready", let address = value["url"] as? String,
               let url = URL(string: address), url.scheme == "http", url.host == "127.0.0.1" {
                officeURL = url
                openItem.title = "Open Office"
                openItem.isEnabled = true
                openOffice()
            } else if value["phase"] as? String == "error" {
                showError(value["message"] as? String ?? "Office could not start.")
            } else if let message = value["message"] as? String { openItem.title = message }
        }
    }

    @objc private func openOffice() {
        if let url = officeURL { NSWorkspace.shared.open(url) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        openOffice()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        quitting = true
        guard let process = runtime, process.isRunning else { return .terminateNow }
        process.terminate()
        return .terminateLater
    }

    private func showError(_ message: String) {
        guard !failed && !quitting else { return }
        failed = true
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Office could not open"
        alert.informativeText = message + "\n\nLogs are in ~/Library/Application Support/The Office/logs."
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let delegate = OfficeDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
