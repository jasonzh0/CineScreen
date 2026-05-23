import Foundation
import OSLog

/// Single OSLog subsystem for the app. Use `Log.capture`, `Log.editor`, etc.
enum Log {
    private static let subsystem = "com.cinescreen.app.native"

    static let app = Logger(subsystem: subsystem, category: "app")
    static let capture = Logger(subsystem: subsystem, category: "capture")
    static let mouse = Logger(subsystem: subsystem, category: "mouse")
    static let permissions = Logger(subsystem: subsystem, category: "permissions")
    static let session = Logger(subsystem: subsystem, category: "session")
    static let editor = Logger(subsystem: subsystem, category: "editor")
}
