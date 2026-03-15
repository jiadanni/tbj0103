#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "🔨 Building and Testing Aetherium..."

# Build the project
./build.sh

# Run the tests
./test.sh

echo "🎉 All Done!"
