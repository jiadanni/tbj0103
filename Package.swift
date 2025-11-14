// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Aetherium",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(
            name: "Aetherium",
            targets: ["Aetherium"]
        )
    ],
    dependencies: [],
    targets: [
        .executableTarget(
            name: "Aetherium",
            dependencies: [],
            path: "Sources/Aetherium"
        ),
        .testTarget(
            name: "AetheriumTests",
            dependencies: ["Aetherium"],
            path: "Tests/AetheriumTests"
        )
    ]
)
