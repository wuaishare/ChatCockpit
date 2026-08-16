import Foundation

enum DesktopL10n {
    private static let localizedBundle: Bundle = {
        let main = Bundle.main
        let explicitLanguages = UserDefaults.standard.stringArray(forKey: "AppleLanguages")
        let preferences = explicitLanguages?.isEmpty == false
            ? explicitLanguages!
            : Locale.preferredLanguages
        let available = Array(Set(main.localizations))
        guard let localization = Bundle.preferredLocalizations(
            from: available,
            forPreferences: preferences
        ).first,
        let path = main.path(forResource: localization, ofType: "lproj"),
        let bundle = Bundle(path: path) else {
            return main
        }
        return bundle
    }()

    static func string(_ key: String) -> String {
        localizedBundle.localizedString(forKey: key, value: key, table: nil)
    }

    static func format(_ key: String, _ arguments: CVarArg...) -> String {
        String(
            format: string(key),
            locale: Locale.current,
            arguments: arguments
        )
    }
}
