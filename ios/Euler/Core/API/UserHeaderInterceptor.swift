import Connect
import Foundation

/// Names the caller's user on every unary call and stream. A trusted-tailnet
/// convenience, not authentication.
nonisolated final class UserHeaderInterceptor: UnaryInterceptor, StreamInterceptor {
    static let header = "x-euler-user-id"
    private let userID: String

    init(userID: String) {
        self.userID = userID
    }

    @Sendable
    func handleUnaryRequest<Message: ProtobufMessage>(
        _ request: HTTPRequest<Message>,
        proceed: @escaping @Sendable (Result<HTTPRequest<Message>, ConnectError>) -> Void
    ) {
        proceed(.success(adding(to: request)))
    }

    @Sendable
    func handleStreamStart(
        _ request: HTTPRequest<Void>,
        proceed: @escaping @Sendable (Result<HTTPRequest<Void>, ConnectError>) -> Void
    ) {
        proceed(.success(adding(to: request)))
    }

    private func adding<Input>(to request: HTTPRequest<Input>) -> HTTPRequest<Input> {
        var headers = request.headers
        headers[Self.header] = [userID]
        return HTTPRequest(
            url: request.url,
            headers: headers,
            message: request.message,
            method: request.method,
            trailers: request.trailers,
            idempotencyLevel: request.idempotencyLevel
        )
    }
}
