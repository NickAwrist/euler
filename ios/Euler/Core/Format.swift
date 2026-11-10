import Foundation
import SwiftProtobuf

/// Dates and durations worded as the web words them.
enum Format {
    /// The chat list's section for a chat last updated at `date`.
    static func group(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        switch days {
        case ...0: return "Today"
        case 1: return "Yesterday"
        case ...7: return "Previous 7 days"
        case ...30: return "Previous 30 days"
        default: return "Older"
        }
    }

    /// How long ago a chat changed: "Just now", "5 min. ago", or a date.
    static func sessionTime(_ date: Date, now: Date = .now) -> String {
        let elapsed = max(0, now.timeIntervalSince(date))
        if elapsed < 60 { return "Just now" }
        if elapsed < 7 * 86_400 {
            let formatter = RelativeDateTimeFormatter()
            formatter.unitsStyle = .short
            return formatter.localizedString(for: date, relativeTo: now)
        }
        let sameYear = Calendar.current.isDate(date, equalTo: now, toGranularity: .year)
        return date.formatted(sameYear ? .dateTime.month(.abbreviated).day() : .dateTime.month(.abbreviated).day().year())
    }

    /// An ephemeral chat's remaining lifetime.
    static func expiresIn(_ date: Date, now: Date = .now) -> String {
        let remaining = date.timeIntervalSince(now)
        if remaining >= 3600 { return "Expires in \(Int(remaining / 3600))h" }
        return "Expires in \(max(1, Int(remaining / 60)))m"
    }

    /// "1.2s", "59s", "2m 5s".
    static func duration(milliseconds: Double) -> String {
        if milliseconds < 1000 { return "\(Int(milliseconds.rounded()))ms" }
        let seconds = milliseconds / 1000
        if seconds < 10 { return String(format: "%.1fs", seconds) }
        if seconds < 60 { return "\(Int(seconds.rounded()))s" }
        let minutes = Int(seconds) / 60
        return "\(minutes)m \(Int(seconds) % 60)s"
    }
}

extension Google_Protobuf_Timestamp {
    var milliseconds: Double { timeIntervalSince1970 * 1000 }
}
