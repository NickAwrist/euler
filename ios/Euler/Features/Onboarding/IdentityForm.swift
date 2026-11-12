import EulerAPI
import SwiftUI

/// The server address and user ID being chosen, before they are saved.
struct IdentityDraft: Equatable {
    var server = ""
    var userID = ""

    init(_ identity: Identity? = nil, server fallback: URL? = nil) {
        server = (identity?.serverURL ?? fallback)?.absoluteString ?? ""
        userID = identity?.userID ?? ""
    }

    var identity: Identity? {
        let id = userID.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let url = Identity.serverURL(from: server), Identity.isValidUserID(id) else { return nil }
        return Identity(serverURL: url, userID: id)
    }

    var userIDIsInvalid: Bool {
        let id = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        return !id.isEmpty && !Identity.isValidUserID(id)
    }

    /// Checks the server answers for this user before it is saved.
    static func verify(_ identity: Identity) async throws {
        let backend = Backend(baseURL: identity.serverURL, userID: identity.userID)
        _ = try await backend.preferences.getEnvironment(request: .init(), headers: [:]).value()
    }
}

/// The fields onboarding and Settings share for choosing a server and user.
struct IdentityFields: View {
    @Binding var draft: IdentityDraft
    @State private var scanning = false

    var body: some View {
        Section("Server") {
            TextField("https://euler.example.ts.net", text: $draft.server)
                .textContentType(.URL)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Server address")
        }
        Section {
            TextField("User ID", text: $draft.userID, axis: .vertical)
                .font(.body.monospaced())
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            if QRScanner.isAvailable {
                Button("Scan QR code", systemImage: "qrcode.viewfinder") { scanning = true }
                    .sheet(isPresented: $scanning) {
                        QRScanner { code in
                            let id = code.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard Identity.isValidUserID(id) else { return false }
                            draft.userID = id.lowercased()
                            scanning = false
                            return true
                        }
                        .ignoresSafeArea()
                        .presentationDragIndicator(.visible)
                    }
            }
            PasteTextButton { draft.userID = $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            Button("Create new user ID", systemImage: "plus.circle") {
                draft.userID = UUID().uuidString.lowercased()
            }
        } header: {
            Text("User")
        } footer: {
            Text(draft.userIDIsInvalid ? "Not a user ID." : "Settings › General › Show QR on the web.")
                .foregroundStyle(draft.userIDIsInvalid ? .red : .secondary)
        }
    }
}

/// First launch: choose the server and the user whose chats to open.
struct OnboardingView: View {
    @Environment(IdentityStore.self) private var identityStore
    @State private var draft = IdentityDraft()
    @State private var connecting = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ThemedForm {
                IdentityFields(draft: $draft)
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Euler")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    if connecting {
                        ProgressView()
                    } else {
                        Button("Connect") { Task { await connect() } }
                            .disabled(draft.identity == nil)
                    }
                }
            }
            .onAppear {
                if draft.server.isEmpty { draft = IdentityDraft(server: identityStore.serverURL) }
            }
        }
    }

    private func connect() async {
        guard let identity = draft.identity else { return }
        connecting = true
        defer { connecting = false }
        do {
            try await IdentityDraft.verify(identity)
            error = nil
            identityStore.save(identity)
        } catch {
            self.error = "Can't reach Euler at \(identity.serverURL.absoluteString): \(error.displayMessage)"
        }
    }
}

/// Changes the server or user from Settings; nothing changes until Save.
struct IdentityEditor: View {
    @Environment(IdentityStore.self) private var identityStore
    @Environment(\.dismiss) private var dismiss
    @State private var draft = IdentityDraft()
    @State private var saving = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ThemedForm {
                IdentityFields(draft: $draft)
                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Server and user")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                CloseToolbarItem(label: "Cancel", placement: .cancellationAction) { dismiss() }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(saving || draft.identity == nil || draft.identity == identityStore.identity)
                }
            }
        }
        .onAppear { draft = IdentityDraft(identityStore.identity) }
    }

    private func save() async {
        guard let identity = draft.identity else { return }
        saving = true
        defer { saving = false }
        do {
            try await IdentityDraft.verify(identity)
            identityStore.save(identity)
            dismiss()
        } catch {
            self.error = "Can't reach Euler: \(error.displayMessage)"
        }
    }
}
