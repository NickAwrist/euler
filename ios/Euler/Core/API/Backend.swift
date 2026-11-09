import Connect
import EulerAPI
import Foundation

/// The Euler server at one address, acting as one user. Built anew when either changes.
nonisolated struct Backend: Sendable {
    let baseURL: URL
    let userID: String
    let events: any Euler_V1_EventServiceClientInterface
    let sessions: any Euler_V1_SessionServiceClientInterface
    let agent: any Euler_V1_AgentServiceClientInterface
    let jobs: any Euler_V1_JobServiceClientInterface
    let attachments: any Euler_V1_AttachmentServiceClientInterface
    let models: any Euler_V1_ModelServiceClientInterface
    let devices: any Euler_V1_DeviceServiceClientInterface
    let preferences: any Euler_V1_PreferenceServiceClientInterface
    let workspace: any Euler_V1_WorkspaceServiceClientInterface
    let skills: any Euler_V1_SkillServiceClientInterface
    let mcpServers: any Euler_V1_McpServerServiceClientInterface
    let providers: any Euler_V1_ProviderServiceClientInterface
    let usage: any Euler_V1_UsageServiceClientInterface
    let directories: any Euler_V1_DirectoryServiceClientInterface

    init(baseURL: URL, userID: String) {
        self.baseURL = baseURL
        self.userID = userID
        let configuration = URLSessionConfiguration.default
        // Streams stay open for minutes; keepalives arrive every five seconds.
        configuration.timeoutIntervalForRequest = 30
        let client = ProtocolClient(
            httpClient: URLSessionHTTPClient(configuration: configuration),
            config: ProtocolClientConfig(
                host: baseURL.appending(path: "api/rpc").absoluteString,
                networkProtocol: .connect,
                codec: ProtoCodec(),
                interceptors: [InterceptorFactory { _ in UserHeaderInterceptor(userID: userID) }]
            )
        )
        events = Euler_V1_EventServiceClient(client: client)
        sessions = Euler_V1_SessionServiceClient(client: client)
        agent = Euler_V1_AgentServiceClient(client: client)
        jobs = Euler_V1_JobServiceClient(client: client)
        attachments = Euler_V1_AttachmentServiceClient(client: client)
        models = Euler_V1_ModelServiceClient(client: client)
        devices = Euler_V1_DeviceServiceClient(client: client)
        preferences = Euler_V1_PreferenceServiceClient(client: client)
        workspace = Euler_V1_WorkspaceServiceClient(client: client)
        skills = Euler_V1_SkillServiceClient(client: client)
        mcpServers = Euler_V1_McpServerServiceClient(client: client)
        providers = Euler_V1_ProviderServiceClient(client: client)
        usage = Euler_V1_UsageServiceClient(client: client)
        directories = Euler_V1_DirectoryServiceClient(client: client)
    }

    /// Resolves a path the server returned, such as `/api/comfyui/view/…`.
    func url(forPath path: String) -> URL? {
        URL(string: path, relativeTo: baseURL)?.absoluteURL
    }
}
