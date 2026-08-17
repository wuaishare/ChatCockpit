import AppKit
import SwiftUI
import TokenPilotDesktopCore

enum NativeStatusSemantic {
    case healthy
    case active
    case pending
    case warning
    case danger
    case inactive
    case unknown

    var systemImage: String {
        switch self {
        case .healthy: return "checkmark.circle.fill"
        case .active: return "bolt.circle.fill"
        case .pending: return "clock.fill"
        case .warning: return "exclamationmark.triangle.fill"
        case .danger: return "xmark.octagon.fill"
        case .inactive: return "pause.circle.fill"
        case .unknown: return "questionmark.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .healthy: return Color(nsColor: .systemGreen)
        case .active: return Color(nsColor: .systemBlue)
        case .pending, .warning: return Color(nsColor: .systemOrange)
        case .danger: return Color(nsColor: .systemRed)
        case .inactive: return Color(nsColor: .secondaryLabelColor)
        case .unknown: return Color(nsColor: .tertiaryLabelColor)
        }
    }
}

struct SemanticStatusPill: View {
    let semantic: NativeStatusSemantic
    let text: String

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: semantic.systemImage)
                .foregroundStyle(semantic.tint)
            Text(text)
                .foregroundStyle(.primary)
        }
        .font(.caption.weight(.medium))
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Color(nsColor: .controlBackgroundColor),
            in: Capsule()
        )
        .overlay {
            Capsule()
                .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5)
        }
        .accessibilityElement(children: .combine)
    }
}

extension DesktopOverallState {
    var nativeSemantic: NativeStatusSemantic {
        switch self {
        case .setupRequired: return .warning
        case .stopped: return .inactive
        case .degraded: return .warning
        case .ready: return .healthy
        }
    }

    var displayName: String {
        switch self {
        case .setupRequired: return DesktopL10n.string("Setup Required")
        case .stopped: return DesktopL10n.string("Stopped")
        case .degraded: return DesktopL10n.string("Needs Attention")
        case .ready: return DesktopL10n.string("Ready")
        }
    }

    var systemImage: String {
        switch self {
        case .setupRequired: return "exclamationmark.triangle"
        case .stopped: return "stop.circle"
        case .degraded: return "exclamationmark.circle"
        case .ready: return "checkmark.circle"
        }
    }
}

extension RuntimeComponentState {
    var nativeSemantic: NativeStatusSemantic {
        switch self {
        case .unknown, .unavailable: return .unknown
        case .stopped: return .inactive
        case .running: return .active
        case .ready: return .healthy
        case .degraded: return .warning
        }
    }

    var displayName: String {
        switch self {
        case .unknown: return DesktopL10n.string("Unknown")
        case .unavailable: return DesktopL10n.string("Unavailable")
        case .stopped: return DesktopL10n.string("Stopped")
        case .running: return DesktopL10n.string("Running")
        case .ready: return DesktopL10n.string("Ready")
        case .degraded: return DesktopL10n.string("Needs Attention")
        }
    }

    var systemImage: String {
        switch self {
        case .ready, .running: return "checkmark.circle"
        case .degraded: return "exclamationmark.circle"
        case .stopped: return "stop.circle"
        case .unknown, .unavailable: return "questionmark.circle"
        }
    }
}
