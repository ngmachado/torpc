.PHONY: all clean build-rust build-ts build example test install check-rust build-binaries binary-release dev-install install-binaries tor-example verify-tor

# Default target
all: build

# Build everything (for users, doesn't require Rust)
build: build-ts

# Build everything (for development, requires Rust)
dev-build: check-rust build-rust build-ts

# Check if Rust is installed
check-rust:
	@echo "Checking Rust installation..."
	@./scripts/check_rust.sh

# Build the Rust FFI bindings
build-rust:
	@echo "Building Rust FFI bindings for Arti..."
	@cd rust/arti-ffi && cargo build --release

# Install pre-built binaries
install-binaries:
	@echo "Installing pre-built binaries for your platform..."
	@node scripts/install_binaries.js

# Build cross-platform binaries (for CI/CD or maintainers)
build-binaries:
	@echo "Building cross-platform binaries..."
	@./scripts/build-binaries.sh

# Build a binary release ZIP without publishing
binary-release: build-binaries build-ts
	@echo "Creating binary release package..."
	@zip -r torpc-release.zip dist/ lib/ package.json README.md LICENSE

# Build the TypeScript project
build-ts:
	@echo "Building TypeScript project..."
	@bun run build

# Run the example (for users, uses pre-built binaries)
example: build install-binaries
	@echo "Running example..."
	@bun run examples/basic-usage.ts

# Run the Tor example (uses real Tor network if binary is available)
tor-example: build install-binaries
	@echo "Running Tor example..."
	@bun run examples/tor-request.ts

# Verify Tor connectivity by comparing real IP with Tor IP
verify-tor: build install-binaries
	@echo "Verifying Tor connectivity..."
	@bun run examples/verify-tor.ts

# Run tests
test:
	@echo "Running tests..."
	@bun test

# Install dependencies (for users, doesn't require Rust)
install: install-binaries
	@echo "Installing dependencies..."
	@bun install

# Install dependencies (for development, requires Rust)
dev-install: check-rust
	@echo "Installing dependencies for development..."
	@bun install
	@cd rust/arti-ffi && cargo fetch

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist
	@cd rust/arti-ffi && cargo clean

# Help
help:
	@echo "Available targets:"
	@echo "  all          : Build everything (default)"
	@echo "  build        : Build TypeScript (for users)"
	@echo "  dev-build    : Build everything (requires Rust)"
	@echo "  check-rust   : Check if Rust is installed"
	@echo "  build-rust   : Build the Rust FFI bindings (requires Rust)"
	@echo "  build-ts     : Build the TypeScript project"
	@echo "  install-binaries : Install pre-built binaries for your platform"
	@echo "  build-binaries : Build binaries for all platforms (for maintainers)"
	@echo "  binary-release : Create a binary release package (for maintainers)"
	@echo "  example      : Run the example"
	@echo "  tor-example  : Run the Tor network example"
	@echo "  verify-tor   : Verify that requests are going through Tor"
	@echo "  test         : Run tests"
	@echo "  install      : Install dependencies (for users)"
	@echo "  dev-install  : Install dependencies for development (requires Rust)"
	@echo "  clean        : Clean build artifacts" 