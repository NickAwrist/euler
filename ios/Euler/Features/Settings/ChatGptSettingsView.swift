import EulerAPI
import SwiftUI

/// ChatGPT sign-in with the web's manual flow: the sign-in page opens in Safari,
/// its redirect to a loopback address fails to load, and the user pastes that
/// address back here.
struct ChatGptSettingsView: View {
    @Environment(AppSession.self) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.palette) private var palette
    @State private var status: Euler_V1_ChatGptStatus?
    @State private var loadError: String?
    /// The sign-in page once opened; its callback holds a one-time code, so it lives in memory only.
    @State private var authorizationURL: URL?
    @State private var callback = ""
    @State private var busy = false
    @State private var error: String?
    @State private var revealed = false

    var body: some View {
        ThemedForm {
            Section {
                header
            }
            if let status {
                if status.connected {
                    connected(status)
                } else if let authorizationURL {
                    callbackSteps(authorizationURL)
                } else {
                    Section {
                        signInButton
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                    } footer: {
                        Text("After signing in, you'll need to copy the redirected URL and paste it here.")
                    }
                }
            } else if let loadError {
                Section {
                    Text(loadError).foregroundStyle(.red)
                    Button("Retry", systemImage: "arrow.clockwise") { Task { await load() } }
                }
            }
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
        }
        .navigationTitle("ChatGPT")
        .task { await load() }
    }

    private var header: some View {
        HStack(spacing: 14) {
            ProviderIcon(icon: .codex, size: 26)
                .frame(width: 48, height: 48)
                .background(palette.fill, in: .rect(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.border))
            VStack(alignment: .leading, spacing: 4) {
                Text("ChatGPT account").font(.headline).foregroundStyle(palette.foreground)
                HStack(spacing: 6) {
                    Circle()
                        .fill(status?.connected == true ? Palette.positive : palette.muted.opacity(0.6))
                        .frame(width: 7, height: 7)
                    Text(status == nil && loadError == nil ? "Loading..." : status?.connected == true ? "Connected" : "Not connected")
                }
                .font(.footnote)
                .foregroundStyle(status?.connected == true ? Palette.positive : palette.muted)
            }
        }
        .padding(.vertical, 4)
    }

    /// The provider's sign-in button: a light pill with its logo, as other sites show it.
    private var signInButton: some View {
        Button { Task { await start(newAccount: false) } } label: {
            HStack(spacing: 10) {
                if busy {
                    ProgressView().tint(.black)
                } else {
                    ProviderIcon(icon: .codex, size: 20, color: .black)
                }
                Text("Sign in with ChatGPT")
                    .font(.body.weight(.semibold))
            }
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(.white, in: .capsule)
            .contentShape(.capsule)
        }
        .buttonStyle(PressableStyle())
        .disabled(busy)
    }

    @ViewBuilder
    private func connected(_ status: Euler_V1_ChatGptStatus) -> some View {
        Section("Account") {
            HStack(spacing: 12) {
                AsyncImage(url: status.hasPicture ? URL(string: status.picture) : nil) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "person.crop.circle.fill")
                        .resizable()
                        .foregroundStyle(palette.muted)
                }
                .frame(width: 40, height: 40)
                .clipShape(.circle)
                VStack(alignment: .leading, spacing: 2) {
                    Text(status.hasName ? status.name : "ChatGPT account")
                        .font(.body.weight(.medium))
                        .foregroundStyle(palette.foreground)
                    if status.hasEmail {
                        Text(status.email)
                            .font(.footnote)
                            .foregroundStyle(palette.muted)
                            .blur(radius: revealed ? 0 : 5)
                            .animation(.easeOut(duration: 0.15), value: revealed)
                            .onTapGesture { revealed.toggle() }
                            .accessibilityLabel(revealed ? status.email : "Show email")
                            .accessibilityAddTraits(.isButton)
                    }
                }
            }
            if !status.planEnabled {
                Text("This sign-in can't use ChatGPT models. Disconnect and sign in again.")
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
            if let url = URL(string: "https://chatgpt.com/settings/usage") {
                Link(destination: url) {
                    Label("View usage limits", systemImage: "arrow.up.right.square")
                }
                .foregroundStyle(palette.foreground)
            }
        }
        Section {
            Button(role: .destructive) { Task { await disconnect() } } label: {
                Label("Disconnect", systemImage: "rectangle.portrait.and.arrow.right")
            }
            .disabled(busy)
        }
    }

    @ViewBuilder
    private func callbackSteps(_ url: URL) -> some View {
        Section("Finish signing in") {
            step(1) {
                Text("Sign in on the \(Text(LocalizedStringKey("[ChatGPT sign-in page](\(url.absoluteString))")).underline()).")
            }
            step(2) { Text("The page it sends you to won't load. Copy its full address.") }
            step(3) { Text("Paste the address below.") }
        }
        Section {
            TextField("http://127.0.0.1:1455/auth/callback?code=...", text: $callback, axis: .vertical)
                .font(.footnote.monospaced())
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .onSubmit { Task { await finish() } }
            if callback.isEmpty {
                PasteTextButton { callback = $0 }
            }
        } header: {
            Text("Callback URL")
        }
        FormActions {
            Button("Cancel", role: .cancel) {
                authorizationURL = nil
                callback = ""
                error = nil
            }
            Button { Task { await finish() } } label: {
                if busy { ProgressView().tint(palette.tintForeground) } else { Text("Connect") }
            }
            .buttonStyle(FormActionStyle(prominent: true))
            .disabled(!callback.contains("code=") || busy)
        }
        Section {
            Button("Use another account", systemImage: "person.2") { Task { await start(newAccount: true) } }
                .disabled(busy)
        }
    }

    private func step(_ number: Int, @ViewBuilder text: () -> Text) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(.caption.weight(.semibold).monospacedDigit())
                .foregroundStyle(palette.tint)
                .frame(width: 20, height: 20)
                .background(palette.tint.opacity(0.12), in: .circle)
            text().font(.subheadline).foregroundStyle(palette.foreground)
        }
    }

    private func load() async {
        do {
            status = try await session.backend.providers.getChatGptStatus(request: .init(), headers: [:]).value().status
            loadError = nil
        } catch {
            loadError = error.displayMessage
        }
    }

    private func start(newAccount: Bool) async {
        var request = Euler_V1_StartChatGptLoginRequest()
        request.newAccount = newAccount
        busy = true
        defer { busy = false }
        do {
            let response = try await session.backend.providers.startChatGptLogin(request: request, headers: [:]).value()
            error = nil
            callback = ""
            if let url = URL(string: response.authorizationURL) {
                authorizationURL = url
                openURL(url)
            }
        } catch {
            self.error = error.displayMessage
        }
    }

    private func finish() async {
        guard callback.contains("code=") else { return }
        var request = Euler_V1_FinishChatGptLoginRequest()
        request.callbackURL = callback.trimmingCharacters(in: .whitespacesAndNewlines)
        busy = true
        defer { busy = false }
        do {
            status = try await session.backend.providers.finishChatGptLogin(request: request, headers: [:]).value().status
            authorizationURL = nil
            callback = ""
            error = nil
            Haptics.success()
            await session.models.load()
        } catch {
            self.error = error.displayMessage
        }
    }

    private func disconnect() async {
        busy = true
        defer { busy = false }
        do {
            let response = try await session.backend.providers.disconnectChatGpt(request: .init(), headers: [:]).value()
            status = Euler_V1_ChatGptStatus()
            if !response.revoked {
                session.notices.info("Disconnected here, but ChatGPT didn't confirm. Remove this app's access in ChatGPT Settings.")
            }
            await session.models.load()
        } catch {
            self.error = error.displayMessage
        }
    }
}
