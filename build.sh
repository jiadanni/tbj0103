#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🔨 Building Aetherium..."

# Build the project using Swift Package Manager
swift build

echo "✅ Build complete!"
