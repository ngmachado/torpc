#!/bin/bash

# Script to build Rust FFI binaries for multiple platforms
# This script should be run by maintainers to create binaries for all supported platforms
# It requires Rust with cross-compilation support

set -e

# Ensure we're in the project root
cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)

echo "Building Rust FFI binaries for all platforms..."

# Create lib directory if it doesn't exist
mkdir -p lib

# Build for the current platform first (as a test)
echo "Building for native platform..."
cd rust/arti-ffi
cargo build --release
cd ../..

# Copy the binary to the appropriate directory
NATIVE_PLATFORM="unknown"
NATIVE_BINARY_NAME="unknown"

case "$(uname -s)" in
    Darwin)
        if [[ "$(uname -m)" == "arm64" ]]; then
            NATIVE_PLATFORM="darwin-arm64"
        else
            NATIVE_PLATFORM="darwin-x64"
        fi
        NATIVE_BINARY_NAME="libarti_ffi.dylib"
        ;;
    Linux)
        if [[ "$(uname -m)" == "aarch64" || "$(uname -m)" == "arm64" ]]; then
            NATIVE_PLATFORM="linux-arm64"
        else
            NATIVE_PLATFORM="linux-x64"
        fi
        NATIVE_BINARY_NAME="libarti_ffi.so"
        ;;
    MINGW*|MSYS*|CYGWIN*)
        NATIVE_PLATFORM="win32-x64"
        NATIVE_BINARY_NAME="arti_ffi.dll"
        ;;
    *)
        echo "Unsupported platform for binary build: $(uname -s)"
        exit 1
        ;;
esac

# Create platform directory if it doesn't exist
mkdir -p "lib/$NATIVE_PLATFORM"

# Copy the binary
cp "rust/arti-ffi/target/release/$NATIVE_BINARY_NAME" "lib/$NATIVE_PLATFORM/"
echo "Binary for $NATIVE_PLATFORM copied to lib/$NATIVE_PLATFORM/$NATIVE_BINARY_NAME"

echo
echo "NOTE: Full cross-compilation support requires additional tools and configuration"
echo "To build for all platforms, you would need to set up cross-compilation toolchains"
echo "or use a CI/CD system like GitHub Actions with matrix builds."
echo
echo "This script has only built for your current platform: $NATIVE_PLATFORM"
echo
echo "For full cross-compilation, you would need to use tools like 'cross' or set up"
echo "Docker environments with the appropriate toolchains for each target platform."
echo "See: https://github.com/cross-rs/cross for more information."
echo
echo "Alternatively, use GitHub Actions to build on multiple platforms."
echo

# For a complete implementation, you would add sections for each target platform
# using cross-compilation tools like 'cross' or using Docker containers
# with the appropriate toolchains.

# Set up color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building torpc Rust FFI binaries...${NC}"

# Create directories for the binaries
mkdir -p lib/darwin-arm64
mkdir -p lib/darwin-x64
mkdir -p lib/linux-x64
mkdir -p lib/linux-arm64
mkdir -p lib/win32-x64

# Determine current platform
PLATFORM=$(uname -s)
ARCH=$(uname -m)
if [[ "$PLATFORM" == "Darwin" ]]; then
  if [[ "$ARCH" == "arm64" ]]; then
    CURRENT="darwin-arm64"
  else
    CURRENT="darwin-x64"
  fi
elif [[ "$PLATFORM" == "Linux" ]]; then
  if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
    CURRENT="linux-arm64"
  else
    CURRENT="linux-x64"
  fi
else
  # Assume Windows
  CURRENT="win32-x64"
fi

# Build for the current platform
echo -e "${YELLOW}Building for current platform: $CURRENT${NC}"

cd rust/arti-ffi

# Check if Rust and Cargo are installed
if ! command -v rustc &> /dev/null || ! command -v cargo &> /dev/null; then
  echo -e "${RED}Error: Rust and Cargo are required for building.${NC}"
  echo -e "${YELLOW}This script is intended for maintainers and CI, not end users.${NC}"
  echo -e "${YELLOW}End users should use the pre-built binaries included in the package.${NC}"
  exit 1
fi

# Build for the current platform
cargo build --release

# Copy the binary to the appropriate location
if [[ "$CURRENT" == "darwin-arm64" || "$CURRENT" == "darwin-x64" ]]; then
  cp target/release/libarti_ffi.dylib ../../lib/$CURRENT/libarti_ffi.dylib
elif [[ "$CURRENT" == "linux-arm64" || "$CURRENT" == "linux-x64" ]]; then
  cp target/release/libarti_ffi.so ../../lib/$CURRENT/libarti_ffi.so
else
  # Windows
  cp target/release/arti_ffi.dll ../../lib/$CURRENT/arti_ffi.dll
fi

cd ../..

echo -e "${GREEN}Successfully built binary for $CURRENT${NC}"
echo -e "${YELLOW}Note: For a complete build, this script should be run on all target platforms${NC}"
echo -e "${YELLOW}or use a cross-compilation setup with GitHub Actions.${NC}"

# Create a README in the lib directory
cat > lib/README.md << EOF
# Pre-built binaries for torpc

This directory contains pre-built Arti FFI binaries for various platforms.
These allow torpc to work without requiring users to install Rust.

## Platforms

- darwin-arm64: macOS on Apple Silicon (M1/M2)
- darwin-x64: macOS on Intel
- linux-x64: Linux on x86_64
- linux-arm64: Linux on ARM64
- win32-x64: Windows on x86_64

## For developers

If you're developing torpc and need to rebuild these binaries:

1. Run \`scripts/build-binaries.sh\` on each platform
2. Or use the GitHub Actions workflow to build for all platforms
EOF

echo -e "${GREEN}Build process completed!${NC}" 