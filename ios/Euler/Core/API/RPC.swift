import Connect
import EulerAPI
import Foundation

extension ResponseMessage {
    /// The response message, or the call's error.
    func value() throws(ConnectError) -> Output {
        try result.get()
    }
}

extension ServerOnlyAsyncStreamInterface {
    /// Sends `input` and yields the server's messages; finishes when the stream
    /// closes cleanly and throws when it fails. Cancelling the consumer cancels the call.
    func messages(sending input: Input) -> AsyncThrowingStream<Output, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    try send(input)
                } catch {
                    continuation.finish(throwing: error)
                    return
                }
                for await result in results() {
                    switch result {
                    case .headers:
                        continue
                    case .message(let message):
                        continuation.yield(message)
                    case .complete(let code, let error, _):
                        if code == .ok {
                            continuation.finish()
                        } else {
                            continuation.finish(throwing: error ?? ConnectError(
                                code: code, message: nil, exception: nil, details: [], metadata: [:]
                            ))
                        }
                        return
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in
                task.cancel()
                cancel()
            }
        }
    }
}

extension ConnectError {
    /// The diagnostic the server attached, with its Euler code.
    var eulerDetail: Euler_V1_ErrorDetail? {
        unpackedDetails().first
    }
}

extension Error {
    /// The message to show a person: the server's public message when it sent one.
    var displayMessage: String {
        if let error = self as? ConnectError {
            return error.message ?? "The request failed (\(error.code))."
        }
        return localizedDescription
    }
}
