// swift-tools-version: 6.2
import PackageDescription

/// The generated Connect contract (`buf generate` from the repo root) and the
/// runtime libraries it needs. Nothing hand-written lives here.
let package = Package(
    name: "EulerAPI",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "EulerAPI", targets: ["EulerAPI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/connectrpc/connect-swift", exact: "1.2.3"),
        .package(url: "https://github.com/apple/swift-protobuf", exact: "1.39.0"),
    ],
    targets: [
        .target(
            name: "EulerAPI",
            dependencies: [
                .product(name: "Connect", package: "connect-swift"),
                .product(name: "SwiftProtobuf", package: "swift-protobuf"),
            ],
            path: "Sources/EulerAPI"
        ),
    ]
)
