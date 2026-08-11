// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "TokenPilotDesktop",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "TokenPilotDesktopCore", targets: ["TokenPilotDesktopCore"]),
        .executable(name: "TokenPilotDesktop", targets: ["TokenPilotDesktop"])
    ],
    targets: [
        .target(name: "TokenPilotDesktopCore"),
        .executableTarget(
            name: "TokenPilotDesktop",
            dependencies: ["TokenPilotDesktopCore"]
        ),
        .testTarget(
            name: "TokenPilotDesktopCoreTests",
            dependencies: ["TokenPilotDesktopCore"]
        )
    ],
    swiftLanguageModes: [.v5]
)
