import Foundation
import LocalAuthentication

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

    private let context = LAContext()
    private let authenticationReason = "Authenticate to access your AI projects and conversations"

    init() {
        checkBiometricType()
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

        // Check if biometric authentication is available
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
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
                .deviceOwnerAuthentication,
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
        isAuthenticated = false
    }

    // MARK: - Auto-lock Support (for future implementation)

    func setupAutoLock(after minutes: Int) {
        // TODO: Implement auto-lock timer
        // Could use a combination of app lifecycle events and timers
    }
}
