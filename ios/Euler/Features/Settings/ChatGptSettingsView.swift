import EulerAPI
import SwiftUI

/// ChatGPT sign-in with the web's manual flow: the sign-in page opens in Safari,
/// its redirect to a loopback address fails to load, and the user pastes that
/// address back here.
struct ChatGptSettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.openURL) private var openURL
    @State private var status: Euler_V1_ChatGptStatus?
    @State private var signingIn = false
    @State private var callback = ""
    @State private var error: String?
    @State private var revealed = false

    var body: some View {
        Form {
            if let status {
                if status.connected {
                    Section("Account") {
                        LabeledContent("Name", value: status.hasName ? status.name : "ChatGPT account")
                        if status.hasEmail {
                            LabeledContent("Email") {
                                Text(status.email)
                                    .blur(radius: revealed ? 0 : 5)
                                    .onTapGesture { revealed.toggle() }
                                    .accessibilityLabel(revealed ? status.email : "Show email")
                            }
                        }
                        if let url = URL(string: "https://chatgpt.com/settings/usage") {
                            Link("View usage limits", destination: url)
                        }
                        Button("Disconnect", role: .destructive) { Task { await disconnect() } }
                    }
                } else {
                    Section {
                        LabeledContent("Status", value: "Not connected")
                        Button("Sign in with ChatGPT") { Task { await start(newAccount: false) } }
                        if signingIn {
                            Button("Use another account") { Task { await start(newAccount: true) } }
                        }
                    }
                    if signingIn {
                        Section {
                            TextField("Callback URL", text: $callback, axis: .vertical)
                                .keyboardType(.URL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .onSubmit { Task { await finish() } }
                            Button("Connect") { Task { await finish() } }
                                .disabled(!callback.contains("code="))
                        } footer: {
                            Text("Copy the address of the page that failed to load after signing in.")
                        }
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("ChatGPT")
        .task {
            status = try? await session.backend.providers.getChatGptStatus(request: .init(), headers: [:]).value().status
        }
    }

    private func start(newAccount: Bool) async {
        var request = Euler_V1_StartChatGptLoginRequest()
        request.newAccount = newAccount
        do {
            let response = try await session.backend.providers.startChatGptLogin(request: request, headers: [:]).value()
            signingIn = true
            error = nil
            if let url = URL(string: response.authorizationURL) { openURL(url) }
        } catch {
            self.error = error.displayMessage
        }
    }

    private func finish() async {
        var request = Euler_V1_FinishChatGptLoginRequest()
        request.callbackURL = callback.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            status = try await session.backend.providers.finishChatGptLogin(request: request, headers: [:]).value().status
            signingIn = false
            callback = ""
            error = nil
            Haptics.success()
            await session.models.load()
        } catch {
            self.error = error.displayMessage
        }
    }

    private func disconnect() async {
        do {
            let response = try await session.backend.providers.disconnectChatGpt(request: .init(), headers: [:]).value()
            status = Euler_V1_ChatGptStatus()
            if !response.revoked { session.notices.info("Disconnected. ChatGPT didn't confirm the sign-out.") }
            await session.models.load()
        } catch {
            self.error = error.displayMessage
        }
    }
}
