import EulerAPI
import SwiftUI

/// Where the chat's tools work: its private sandbox, a folder on the server, or
/// another chat's workspace. There is no Reveal in Finder on a phone.
struct WorkspaceSheet: View {
    let chat: ChatStore
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette

    var body: some View {
        NavigationStack {
            List {
                Section("Current") {
                    Label(currentLabel, systemImage: currentIcon)
                }
                Section {
                    Button("Private sandbox", systemImage: "shippingbox") { Task { await useSandbox() } }
                        .disabled(isPrivateSandbox)
                    NavigationLink {
                        DirectoryBrowser { path in Task { await select(path) } }
                    } label: {
                        Label("Folder on the server", systemImage: "folder")
                    }
                    NavigationLink {
                        LinkChatList(current: chat.id) { source in Task { await link(source) } }
                    } label: {
                        Label("Another chat's workspace", systemImage: "link")
                    }
                }
            }
            .navigationTitle("Workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private var workspace: Euler_V1_SessionWorkspace? { chat.session?.workspace }

    private var isPrivateSandbox: Bool {
        if case .sandbox(let sandbox) = workspace?.kind { return !sandbox.hasLinked }
        return workspace?.kind == nil
    }

    private var currentLabel: String {
        switch workspace?.kind {
        case .local(let local): "Working in \(local.label)"
        case .sandbox(let sandbox) where sandbox.hasLinked:
            if sandbox.linked.hasSessionID, let summary = session.sessions.summary(sandbox.linked.sessionID) {
                "Linked to \(summary.title)"
            } else {
                "Linked to another chat's workspace"
            }
        default: "Private sandbox"
        }
    }

    private var currentIcon: String {
        switch workspace?.kind {
        case .local: "folder"
        case .sandbox(let sandbox) where sandbox.hasLinked: "link"
        default: "shippingbox"
        }
    }

    private func useSandbox() async {
        var request = Euler_V1_UseSandboxRequest()
        request.sessionID = chat.id
        await apply { try await session.backend.workspace.useSandbox(request: request, headers: [:]).value().workspace }
    }

    private func select(_ path: String) async {
        var request = Euler_V1_SelectDirectoryRequest()
        request.sessionID = chat.id
        request.path = path
        await apply { try await session.backend.workspace.selectDirectory(request: request, headers: [:]).value().workspace }
    }

    private func link(_ source: String) async {
        var request = Euler_V1_LinkWorkspaceRequest()
        request.sessionID = chat.id
        request.sourceSessionID = source
        await apply { try await session.backend.workspace.linkWorkspace(request: request, headers: [:]).value().workspace }
    }

    private func apply(_ change: () async throws -> Euler_V1_SessionWorkspace) async {
        let ok = await session.notices.attempt {
            chat.adoptWorkspace(try await change())
        }
        if ok {
            Haptics.success()
            dismiss()
        }
    }
}

/// Folders on the server, from its home or starting folder down.
struct DirectoryBrowser: View {
    var path: String?
    let choose: (String) -> Void
    @Environment(AppSession.self) private var session
    @State private var listing: Euler_V1_ListDirectoryResponse?
    @State private var error: String?

    var body: some View {
        List {
            if let listing {
                Section {
                    Button("Use this folder", systemImage: "checkmark.circle") { choose(listing.path) }
                } footer: {
                    Text(listing.path).font(.caption.monospaced())
                }
                Section {
                    ForEach(listing.directories, id: \.path) { directory in
                        NavigationLink {
                            DirectoryBrowser(path: directory.path, choose: choose)
                        } label: {
                            Label(directory.name, systemImage: "folder")
                        }
                    }
                }
            } else if let error {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(listing.map { ($0.path as NSString).lastPathComponent } ?? "Folders")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            var request = Euler_V1_ListDirectoryRequest()
            if let path { request.path = path }
            do {
                listing = try await session.backend.directories.listDirectory(request: request, headers: [:]).value()
            } catch {
                self.error = error.displayMessage
            }
        }
    }
}

private struct LinkChatList: View {
    let current: String
    let choose: (String) -> Void
    @Environment(AppSession.self) private var session

    var body: some View {
        List(session.sessions.sessions.filter { $0.id != current }, id: \.id) { summary in
            Button(summary.title) { choose(summary.id) }
        }
        .navigationTitle("Link a chat")
        .navigationBarTitleDisplayMode(.inline)
    }
}
