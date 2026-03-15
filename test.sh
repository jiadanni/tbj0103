#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🧪 Running Aetherium Tests..."

# Run the test suite using Swift Package Manager
swift test

echo "✅ Tests complete!"
