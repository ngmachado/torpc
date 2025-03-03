# Torpc - Tor Privacy Connections for JavaScript

TorPC is a library that allows you to make HTTP requests through the Tor network from JavaScript applications. It uses the [Arti](https://gitlab.torproject.org/tpo/core/arti) Rust implementation of Tor via FFI bindings in Bun.

## Features

- Connect to the Tor network using the Arti implementation
- Create and manage Tor circuits for improved privacy
- Make HTTP requests through Tor
- Verify Tor connectivity
- Custom configuration support

## Current Status

The library currently supports:

- ✅ HTTP requests through Tor
- ✅ Circuit creation and management
- ✅ Low-level stream API for custom protocols
- ✅ Configuration through Arti's TOML files
- ❌ HTTPS support (planned for future releases)

## Installation

```bash
# Install using npm
npm install torpc

# Or using Bun
bun add torpc
```

## Usage

### Basic HTTP Request

```typescript
import { getArtiClient } from 'torpc';

// Get the Arti client
const client = getArtiClient();

// Circuit ID for this request
const circuitId = `my-circuit-${Date.now()}`;

async function main() {
  try {
    // Connect to Tor network
    await client.connect();
    console.log("Connected to Tor network");

    // Create a circuit
    await client.createCircuit(circuitId);
    console.log(`Circuit created: ${circuitId}`);

    // Make an HTTP request through Tor
    const response = await client.httpRequest(
      circuitId,
      "http://httpbin.org/get",
      "GET",
      { "Accept": "application/json" }
    );

    // Display the response
    console.log("Response status:", response.status);
    console.log("Response headers:", response.headers);
    console.log("Response body:", response.body);

    // Clean up
    await client.destroyCircuit(circuitId);
    await client.disconnect();
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
```

### Using Custom Configuration

```typescript
import { getArtiClient } from 'torpc';
import path from 'path';

// Specify a custom configuration path
const configPath = path.join(process.cwd(), 'config/arti.toml');

// Get the Arti client with custom config
const client = getArtiClient({
  verbose: true,
  configPath
});

// Use the client as shown in the basic example
```

### Low-level Stream API

For advanced usage, you can use the low-level stream API:

```typescript
import { getArtiClient } from 'torpc';

async function main() {
  const client = getArtiClient();
  await client.connect();
  
  const circuitId = `stream-example-${Date.now()}`;
  await client.createCircuit(circuitId);
  
  // Connect to a target
  const streamId = await client.connectStream(circuitId, "example.com", 80);
  
  // Write data to the stream
  const request = new TextEncoder().encode("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");
  await client.writeStream(streamId, request);
  await client.flushStream(streamId);
  
  // Read response
  const response = await client.readStream(streamId, 4096);
  console.log(new TextDecoder().decode(response));
  
  // Close the stream and clean up
  await client.closeStream(streamId);
  await client.destroyCircuit(circuitId);
  await client.disconnect();
}

main();
```

## Configuration

TorPC uses Arti's configuration system based on TOML files. A default configuration is provided, but you can specify your own configuration file.

Example configuration file (`arti.toml`):

```toml
# Basic Arti configuration for TorPC

[application]
# Whether to report our version when we build a circuit
permit_debugging = true
# Whether to download missing directory data if needed
allow_missing_dir_info = true
# How many DNS requests to allow in parallel (0 for "no limit")
max_concurrent_dns_lookups = 0
# How many circuits to try to build in parallel
max_concurrent_circuit_builds = 4

[network]
# Whether to have the SOCKS port automatically fall back to another port if the
# configured one is in use
fallback_socks_port = true

[tor_network]
# Whether to enforce that relays have RSA identity keys (required by current Tor)
enforce_rsa_identity_keys = true
# Minimum number of consensus'es we want to get from the directory
min_target_consensus_count = 2
# How to handle consensus caching
cache_consensus = true
# How to handle micro-description caching
cache_micro_desc = true
# Default circuit and stream timeout (10 minutes)
circuit_build_timeout = "10 minutes"
# Allow retry if circuit fails
retry_on_circuit_build_timeout = true

[path_rules]
# Path selection parameters
ipv4_subnet_family_prefix = 24
ipv6_subnet_family_prefix = 48 
```

## API Reference

### `getArtiClient(options?): ArtiClient`

Creates a new Arti client instance.

**Parameters:**
- `options` (optional): Configuration options for the client
  - `verbose`: Whether to enable verbose logging (default: false)
  - `configPath`: Path to a custom Arti configuration file (default: none)

**Returns:** An `ArtiClient` instance

### ArtiClient Interface

```typescript
interface ArtiClient {
    // Basic connection management
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    
    // Circuit management
    createCircuit(circuitId: string): Promise<void>;
    destroyCircuit(circuitId: string): Promise<void>;
    
    // HTTP requests
    httpRequest(
        circuitId: string,
        url: string,
        method: string,
        headers: Record<string, string>,
        body?: string
    ): Promise<{
        status: number;
        headers: Record<string, string>;
        body: string;
    }>;
    
    // Low-level stream API
    connectStream(circuitId: string, targetHost: string, targetPort: number): Promise<string>;
    writeStream(streamId: string, data: Uint8Array): Promise<void>;
    flushStream(streamId: string): Promise<void>;
    readStream(streamId: string, maxBytes: number): Promise<Uint8Array>;
    closeStream(streamId: string): Promise<void>;
}
```

## Security Considerations

- **Development Status**: This library is still in development. Use at your own risk.
- **Not for Critical Privacy Needs**: While this library uses Arti, a legitimate Tor implementation, it has not undergone security audits and should not be used for critical privacy needs.
- **HTTPS Support**: Currently, the library only supports plain HTTP. For security-sensitive applications, you should wait for HTTPS support to be implemented.

## Future Plans

- Add HTTPS support
- Improve error handling and recovery
- Add circuit isolation features
- Add circuit rotation features
- Implement proper connection pooling
- Add more examples and documentation

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Acknowledgements

- [Tor Project](https://www.torproject.org/) for Tor
- [Arti](https://gitlab.torproject.org/tpo/core/arti) for the Rust implementation of Tor
- [Bun](https://bun.sh/) for the JavaScript runtime with FFI capabilities
