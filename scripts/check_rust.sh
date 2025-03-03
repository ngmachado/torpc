#!/bin/bash

# Script to check if Rust and its tools are installed and properly configured

function print_error() {
    echo "❌ $1"
}

function print_success() {
    echo "✅ $1"
}

function print_info() {
    echo "ℹ️  $1"
}

# Check if rustc is available
if command -v rustc &> /dev/null; then
    print_success "Rust compiler (rustc) is installed"
    RUSTC_VERSION=$(rustc --version)
    print_info "Rust version: $RUSTC_VERSION"
else
    print_error "Rust compiler (rustc) is not installed"
    print_info "Please install Rust by following the instructions at https://www.rust-lang.org/tools/install"
    print_info "Typically, you can install Rust by running: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check if cargo is available
if command -v cargo &> /dev/null; then
    print_success "Cargo package manager is installed"
    CARGO_VERSION=$(cargo --version)
    print_info "Cargo version: $CARGO_VERSION"
else
    print_error "Cargo package manager is not installed"
    print_info "Cargo should be installed with Rust. Please reinstall Rust using rustup."
    exit 1
fi

# Check if the required target is installed for cross compilation
# This is just an example - uncomment and modify as needed for your project
# REQUIRED_TARGET="wasm32-unknown-unknown"
# if rustup target list | grep -q "$REQUIRED_TARGET (installed)"; then
#     print_success "Required target $REQUIRED_TARGET is installed"
# else
#     print_error "Required target $REQUIRED_TARGET is not installed"
#     print_info "Please install it using: rustup target add $REQUIRED_TARGET"
#     exit 1
# fi

print_success "Rust environment is properly configured"
exit 0 