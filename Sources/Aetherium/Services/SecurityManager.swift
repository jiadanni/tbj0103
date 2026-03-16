import Foundation
import LocalAuthentication
import AppKit

enum BiometricType {
    case none
    case touchID
    case faceID
    case opticID
}

enum AuthenticationError: LocalizedError {
    case biometricNotAvailable
    case biometricNotEnrolled
    case authenticationFailed
    case userCanceled
    case unknown(Error)

    var errorDescription: String? {
        switch self {
        case .biometricNotAvailable:
            return "Biometric authentication is not available on this device"
        case .biometricNotEnrolled:
            return "No biometric credentials are enrolled"
        case .authenticationFailed:
            return "Authentication failed"
        case .userCanceled:
            return "Authentication was canceled"
        case .unknown(let error):
            return "An error occurred: \(error.localizedDescription)"
        }
    }
}

@MainActor
class SecurityManager: ObservableObject {
    @Published var isAuthenticated: Bool = false
    @Published var biometricType: BiometricType = .none
    @Published var autoLockMinutes: Int = 0

    private let context = LAContext()
    private let authenticationReason = "Authenticate to access your AI projects and conversations"
    private var autoLockTimer: Timer?
    private var resignObserver: Any?
    private var becomeActiveObserver: Any?

    init() {
        checkBiometricType()
        let minutes = AppSettings.shared.autoLockMinutes
        if minutes > 0 {
            setupAutoLock(after: minutes)
        }
        // Auto-authenticate if Touch ID is disabled
        if !AppSettings.shared.touchIDEnabled {
            isAuthenticated = true
        }
    }

    // MARK: - Biometric Type Detection

    func checkBiometricType() {
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            biometricType = .none
            return
        }

        switch context.biometryType {
        case .none:
            biometricType = .none
        case .touchID:
            biometricType = .touchID
        case .faceID:
            biometricType = .faceID
        case .opticID:
            biometricType = .opticID
        @unknown default:
            biometricType = .none
        }
    }

    // MARK: - Authentication

    func authenticate() async throws {
        let context = LAContext()
        var error: NSError?

        // Try biometric first, fall back to device passcode
        let policy: LAPolicy
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
            policy = .deviceOwnerAuthenticationWithBiometrics
        } else if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) {
            policy = .deviceOwnerAuthentication
        } else {
            if let error = error {
                switch error.code {
                case LAError.biometryNotAvailable.rawValue:
                    throw AuthenticationError.biometricNotAvailable
                case LAError.biometryNotEnrolled.rawValue:
                    throw AuthenticationError.biometricNotEnrolled
                default:
                    throw AuthenticationError.unknown(error)
                }
            }
            throw AuthenticationError.biometricNotAvailable
        }

        do {
            // Attempt authentication
            let success = try await context.evaluatePolicy(
                policy,
                localizedReason: authenticationReason
            )

            if success {
                isAuthenticated = true
            } else {
                throw AuthenticationError.authenticationFailed
            }
        } catch let error as LAError {
            switch error.code {
            case .userCancel, .userFallback, .systemCancel:
                throw AuthenticationError.userCanceled
            case .authenticationFailed:
                throw AuthenticationError.authenticationFailed
            default:
                throw AuthenticationError.unknown(error)
            }
        } catch {
            throw AuthenticationError.unknown(error)
        }
    }

    func logout() {
        if AppSettings.shared.touchIDEnabled {
            isAuthenticated = false
        }
    }

    func lockForTimeout() {
        isAuthenticated = false
    }

    // MARK: - Auto-lock Support

    func setupAutoLock(after minutes: Int) {
        autoLockMinutes = minutes
        cancelAutoLockTimer()

        guard minutes > 0 else {
            removeAppLifecycleObservers()
            return
        }

        observeAppLifecycle()
    }

    func resetAutoLockTimer() {
        cancelAutoLockTimer()
        guard autoLockMinutes > 0, isAuthenticated else { return }
        let interval = TimeInterval(autoLockMinutes * 60)
        autoLockTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: false) { [weak self] _ in
            Task { @MainActor in
                self?.lockForTimeout()
            }
        }
    }

    private func cancelAutoLockTimer() {
        autoLockTimer?.invalidate()
        autoLockTimer = nil
    }

    private func observeAppLifecycle() {
        removeAppLifecycleObservers()

        resignObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.resetAutoLockTimer()
            }
        }

        becomeActiveObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.cancelAutoLockTimer()
            }
        }
    }

    private func removeAppLifecycleObservers() {
        if let observer = resignObserver {
            NotificationCenter.default.removeObserver(observer)
            resignObserver = nil
        }
        if let observer = becomeActiveObserver {
            NotificationCenter.default.removeObserver(observer)
            becomeActiveObserver = nil
        }
    }
}
