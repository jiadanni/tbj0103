import SwiftUI

struct AuthenticationView: View {
    @EnvironmentObject var securityManager: SecurityManager
    @EnvironmentObject var ollamaService: OllamaService
    @EnvironmentObject var demoModeManager: DemoModeManager
    @State private var isAuthenticating = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: 30) {
            // App Logo/Icon
            Image(systemName: "brain.head.profile")
                .font(.system(size: 80))
                .foregroundStyle(.blue.gradient)

            VStack(spacing: 8) {
                Text("Aetherium")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("Your Local AI Learning Companion")
                    .font(.title3)
                    .foregroundColor(.secondary)
            }

            Spacer()
                .frame(height: 40)

            // Biometric status
            HStack(spacing: 12) {
                Image(systemName: biometricIcon)
                    .font(.title2)
                Text(biometricDescription)
                    .font(.body)
            }
            .foregroundColor(.secondary)
            .padding()
            .background(Color.secondary.opacity(0.1))
            .cornerRadius(12)

            // Authenticate button
            Button(action: authenticate) {
                HStack {
                    if isAuthenticating {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(isAuthenticating ? "Authenticating..." : "Unlock Aetherium")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color.blue)
                .foregroundColor(.white)
                .cornerRadius(12)
            }
            .disabled(isAuthenticating)
            .frame(maxWidth: 300)

            // Error message
            if let error = errorMessage {
                Text(error)
                    .font(.callout)
                    .foregroundColor(.red)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            // Try Demo
            Button(action: startDemo) {
                Text("Try Demo — no account needed")
                    .font(.callout)
                    .foregroundColor(.secondary)
            }
            .buttonStyle(.plain)
            .padding(.top, 4)

            Spacer()
        }
        .padding(40)
        .frame(minWidth: 500, minHeight: 600)
    }

    private var biometricIcon: String {
        switch securityManager.biometricType {
        case .touchID:
            return "touchid"
        case .faceID:
            return "faceid"
        case .opticID:
            return "opticid"
        case .none:
            return "lock.shield"
        }
    }

    private var biometricDescription: String {
        switch securityManager.biometricType {
        case .touchID:
            return "Touch ID required"
        case .faceID:
            return "Face ID required"
        case .opticID:
            return "Optic ID required"
        case .none:
            return "Password required"
        }
    }

    private func authenticate() {
        // If Touch ID is disabled, just unlock immediately
        guard AppSettings.shared.touchIDEnabled else {
            securityManager.isAuthenticated = true
            return
        }

        isAuthenticating = true
        errorMessage = nil

        Task {
            do {
                try await securityManager.authenticate()
            } catch {
                errorMessage = error.localizedDescription
            }
            isAuthenticating = false
        }
    }

    private func startDemo() {
        demoModeManager.activate(ollamaService: ollamaService)
        securityManager.isAuthenticated = true
    }
}
