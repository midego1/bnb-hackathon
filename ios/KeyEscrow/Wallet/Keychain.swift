import Foundation
import Security

/// Generic-password Keychain items, this device only (never synced to iCloud, never in backups).
enum Keychain {
    static let service = "org.keyescrow.ios.testnet"

    enum Read { case found(Data), notFound, failed(OSStatus) }

    static func read(_ account: String) -> Read {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
            kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        let status = SecItemCopyMatching(q as CFDictionary, &out)
        if status == errSecSuccess, let d = out as? Data { return .found(d) }
        return status == errSecItemNotFound ? .notFound : .failed(status)
    }

    /// Adds a new item; never replaces an existing one (a wallet key is never overwritten).
    @discardableResult
    static func add(_ data: Data, _ account: String) -> Bool {
        let q: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account,
            kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecAttrSynchronizable as String: false,
        ]
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    static func delete(_ account: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
}
