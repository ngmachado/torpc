/**
 * Bindings module for Arti (Rust's Tor implementation) integration
 */
import { dlopen, FFIType, ptr, toArrayBuffer } from 'bun:ffi';
import { platform, arch } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Options for Arti client
 */
export interface ArtiClientOptions {
    /**
     * Whether to enable verbose logging
     */
    verbose?: boolean;

    /**
     * Path to a custom Arti configuration file (TOML format)
     * If not provided, will look for arti.toml in the current directory
     */
    configPath?: string;
}

/**
 * Interface for Arti Tor client
 */
export interface ArtiClient {
    /**
     * Connect to the Tor network
     */
    connect(): Promise<void>;

    /**
     * Disconnect from the Tor network
     */
    disconnect(): Promise<void>;

    /**
     * Create a new circuit
     * @param circuitId Unique circuit identifier
     */
    createCircuit(circuitId: string): Promise<void>;

    /**
     * Destroy an existing circuit
     * @param circuitId Circuit identifier to destroy
     */
    destroyCircuit(circuitId: string): Promise<void>;

    /**
     * Check if connected to the Tor network
     */
    isConnected(): boolean;

    /**
     * Make an HTTP request through Tor
     * @param circuitId Circuit ID to use
     * @param url URL to request
     * @param method HTTP method (GET, POST, etc.)
     * @param headers HTTP headers as a record
     * @param body Request body (optional)
     */
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

    // New stream-based API methods
    connectStream(circuitId: string, targetHost: string, targetPort: number): Promise<string>;
    writeStream(streamId: string, data: Uint8Array): Promise<void>;
    flushStream(streamId: string): Promise<void>;
    readStream(streamId: string, maxBytes: number): Promise<Uint8Array>;
    closeStream(streamId: string): Promise<void>;
}

/**
 * Get the path to the appropriate pre-built binary for the current platform
 */
export function getArtiBinaryPath(): string {
    // Determine platform
    const plat = platform();
    const architecture = arch();

    let platformDir: string;
    let extension: string;
    let prefix: string = 'lib';

    // Map platform and architecture to directory name
    if (plat === 'darwin') {
        platformDir = architecture === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
        extension = '.dylib';
    } else if (plat === 'linux') {
        platformDir = architecture === 'arm64' || architecture === 'aarch64'
            ? 'linux-arm64'
            : 'linux-x64';
        extension = '.so';
    } else if (plat === 'win32') {
        platformDir = 'win32-x64'; // Currently only support 64-bit Windows
        extension = '.dll';
        prefix = ''; // No 'lib' prefix on Windows
    } else {
        throw new Error(`Unsupported platform: ${plat} ${architecture}`);
    }

    // Construct binary name
    const binaryName = `${prefix}arti_ffi${extension}`;

    // Try to locate the binary
    const possibleLocations = [
        // From local project
        join(process.cwd(), 'lib', platformDir, binaryName),
        // From package in node_modules
        join(__dirname, '..', '..', 'lib', platformDir, binaryName),
        // From locally built binary
        join(process.cwd(), 'rust', 'arti-ffi', 'target', 'release', binaryName)
    ];

    for (const location of possibleLocations) {
        if (existsSync(location)) {
            console.log(`Found Arti binary at: ${location}`);
            return location;
        }
    }

    // If we get here, we couldn't find the binary
    console.warn('Could not find Arti binary. Please build it with `cd rust/arti-ffi && cargo build --release`');
    return '';
}

/**
 * Real implementation of the Arti client using Bun FFI bindings
 */
export class BunArtiClient implements ArtiClient {
    private connected: boolean = false;
    private circuits: Set<string> = new Set();
    private lib: any;
    private verbose: boolean = false;
    private options?: ArtiClientOptions;

    constructor(binaryPath: string, options?: ArtiClientOptions) {
        this.verbose = options?.verbose || false;
        this.options = options;

        try {
            // Load the dynamic library
            this.lib = dlopen(binaryPath, {
                arti_init: {
                    args: [],
                    returns: FFIType.int,
                },
                arti_init_with_config: {
                    args: [FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_connect: {
                    args: [],
                    returns: FFIType.int,
                },
                arti_disconnect: {
                    args: [],
                    returns: FFIType.int,
                },
                arti_is_connected: {
                    args: [],
                    returns: FFIType.int,
                },
                arti_create_circuit: {
                    args: [FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_destroy_circuit: {
                    args: [FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_connect_stream: {
                    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
                    returns: FFIType.int,
                },
                arti_write_stream: {
                    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
                    returns: FFIType.int,
                },
                arti_flush_stream: {
                    args: [FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_read_stream: {
                    args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_close_stream: {
                    args: [FFIType.ptr],
                    returns: FFIType.int,
                },
            });

            // Initialize Arti
            console.log('Initializing Arti FFI with binary at:', binaryPath);
            console.log('Initializing Arti...');
            const result = this.lib.symbols.arti_init();

            if (result !== 1) {
                throw new Error('Failed to initialize Arti FFI');
            }
            console.log('Arti initialized successfully.');
        } catch (error) {
            throw new Error(`Failed to load Arti binary: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    async connect(): Promise<void> {
        if (this.connected) {
            if (this.verbose) console.log("Already connected to Tor network");
            return;
        }

        try {
            // Initialize Arti client with config path if provided
            let result: number;

            if (this.options?.configPath) {
                const configPathPtr = Buffer.from(this.options.configPath + '\0', 'utf8');
                result = this.lib.symbols.arti_init_with_config(ptr(configPathPtr));
            } else {
                result = this.lib.symbols.arti_init();
            }

            if (result !== 1) {
                throw new Error("Failed to initialize Arti client");
            }

            // Connect to Tor network
            result = this.lib.symbols.arti_connect();
            if (result !== 1) {
                throw new Error("Failed to connect to Tor network");
            }

            this.connected = true;
            if (this.verbose) console.log("Connected to Tor network");
        } catch (error) {
            console.error("Error connecting to Tor:", error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (!this.connected) {
            return;
        }

        console.log('Disconnecting from Tor network...');
        const result = this.lib.symbols.arti_disconnect();
        if (result !== 1) {
            throw new Error('Failed to disconnect from Tor network');
        }

        this.connected = false;
        this.circuits.clear();
        console.log('Disconnected from Tor network successfully.');
    }

    async createCircuit(circuitId: string): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        if (this.circuits.has(circuitId)) {
            throw new Error(`Circuit with ID ${circuitId} already exists`);
        }

        console.log(`Creating circuit: ${circuitId}`);

        // Convert the JavaScript string to a buffer that FFI can handle
        const circuitIdBuffer = Buffer.from(circuitId + '\0', 'utf8');
        const result = this.lib.symbols.arti_create_circuit(circuitIdBuffer);

        if (result !== 1) {
            throw new Error(`Failed to create circuit ${circuitId}`);
        }

        this.circuits.add(circuitId);
        console.log(`Circuit created: ${circuitId}`);
    }

    async destroyCircuit(circuitId: string): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        if (!this.circuits.has(circuitId)) {
            throw new Error(`Circuit with ID ${circuitId} does not exist`);
        }

        console.log(`Destroying circuit: ${circuitId}`);

        // Convert the JavaScript string to a buffer that FFI can handle
        const circuitIdBuffer = Buffer.from(circuitId + '\0', 'utf8');
        const result = this.lib.symbols.arti_destroy_circuit(circuitIdBuffer);

        if (result !== 1) {
            throw new Error(`Failed to destroy circuit ${circuitId}`);
        }

        this.circuits.delete(circuitId);
        console.log(`Circuit destroyed: ${circuitId}`);
    }

    isConnected(): boolean {
        try {
            const result = this.lib.symbols.arti_is_connected();
            return result === 1;
        } catch (e) {
            return false;
        }
    }

    async httpRequest(
        circuitId: string,
        url: string,
        method: string,
        headers: Record<string, string>,
        body?: string
    ): Promise<{
        status: number;
        headers: Record<string, string>;
        body: string;
    }> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        if (!this.circuits.has(circuitId)) {
            throw new Error(`Circuit "${circuitId}" does not exist`);
        }

        // Log the request details
        console.log('DEBUG - Making HTTP request with:', {
            circuitId,
            url,
            method,
            headers: JSON.stringify(headers),
            bodyLength: body?.length ?? 0,
        });

        // Parse the URL to get host, port, and path
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname;
        const isHttps = parsedUrl.protocol === 'https:';
        const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (isHttps ? 443 : 80);
        const path = parsedUrl.pathname + parsedUrl.search;

        if (isHttps) {
            // HTTPS is not yet supported
            throw new Error('HTTPS support is not yet implemented. Please use http:// URLs only.');
        }

        try {
            // Connect a stream to the target
            console.log(`Connecting stream to ${host}:${port} via circuit ${circuitId}`);
            const streamId = await this.connectStream(circuitId, host, port);
            console.log(`Stream connected: ${streamId}`);

            // Handle HTTP request
            const responseData = await this.handleHttpRequest(streamId, host, method, path, headers, body);

            // If we didn't get any data, throw an error
            if (responseData.length === 0) {
                throw new Error('No response received from Tor network. Possible reasons: Tor network connectivity issues, invalid URL, or target server not responding.');
            }

            // Parse the HTTP response
            const responseText = new TextDecoder().decode(responseData);
            console.log('DEBUG - Raw response:', responseText);

            const parsedResponse = this.parseHttpResponse(responseText);

            return {
                status: parsedResponse.status,
                headers: parsedResponse.headers,
                body: parsedResponse.body
            };
        } catch (error) {
            console.error('Error in HTTP request through Tor:', error);
            throw error;
        }
    }

    /**
     * Handle a plain HTTP request through a Tor stream
     */
    private async handleHttpRequest(
        streamId: string,
        host: string,
        method: string,
        path: string,
        headers: Record<string, string>,
        body?: string
    ): Promise<Uint8Array> {
        // Construct HTTP request
        const httpRequest = this.constructHttpRequest(method, path, headers, host, body);
        console.log('DEBUG - HTTP request:', httpRequest);

        // Write the request to the stream
        const requestData = new TextEncoder().encode(httpRequest);
        await this.writeStream(streamId, requestData);
        await this.flushStream(streamId);
        console.log('DEBUG - Request written to stream');

        // Read the response
        let responseData = new Uint8Array(0);
        const chunkSize = 4096;
        let chunk: Uint8Array;

        try {
            // Read in chunks until we get a complete HTTP response
            let totalRead = 0;
            do {
                chunk = await this.readStream(streamId, chunkSize);
                if (chunk.length > 0) {
                    // Combine with previous chunks
                    const newData = new Uint8Array(responseData.length + chunk.length);
                    newData.set(responseData);
                    newData.set(chunk, responseData.length);
                    responseData = newData;
                    totalRead += chunk.length;
                }

                // Check if we have a complete HTTP response
                // This is a simplistic check - in a real implementation we'd parse headers to get Content-Length
                const responseText = new TextDecoder().decode(responseData);
                if (responseText.includes('\r\n\r\n') &&
                    (responseText.startsWith('HTTP/1.') || responseText.startsWith('HTTP/2'))) {
                    if (totalRead > 0) break; // We have at least some data in a valid HTTP format
                }
            } while (chunk.length > 0);

            console.log(`DEBUG - Read ${totalRead} bytes from stream`);
            return responseData;
        } finally {
            // Always close the stream
            await this.closeStream(streamId);
            console.log('DEBUG - Stream closed');
        }
    }

    /**
     * Construct an HTTP request string
     */
    private constructHttpRequest(
        method: string,
        path: string,
        headers: Record<string, string>,
        host: string,
        body?: string
    ): string {
        let httpRequest = `${method} ${path} HTTP/1.1\r\n`;
        httpRequest += `Host: ${host}\r\n`;

        // Add custom headers
        for (const [key, value] of Object.entries(headers)) {
            httpRequest += `${key}: ${value}\r\n`;
        }

        // Add Content-Length if we have a body
        if (body) {
            httpRequest += `Content-Length: ${body.length}\r\n`;
        }

        // End headers
        httpRequest += '\r\n';

        // Add body if present
        if (body) {
            httpRequest += body;
        }

        return httpRequest;
    }

    /**
     * Parse an HTTP response string
     */
    private parseHttpResponse(responseText: string): {
        status: number;
        headers: Record<string, string>;
        body: string;
    } {
        // Split into headers and body
        const parts = responseText.split('\r\n\r\n', 2);
        const headersText = parts[0];
        const body = parts.length > 1 ? parts[1] : '';

        // Parse the status line and headers
        const lines = headersText.split('\r\n');
        const statusLine = lines[0];
        const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
        const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

        // Parse headers
        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                headers[key] = value;
            }
        }

        return { status, headers, body };
    }

    async connectStream(circuitId: string, targetHost: string, targetPort: number): Promise<string> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        if (!this.circuits.has(circuitId)) {
            throw new Error(`Circuit "${circuitId}" does not exist`);
        }

        // Create a buffer to receive the stream ID (max 1024 chars should be plenty)
        const streamIdBuffer = Buffer.alloc(1024);

        // Connect to the target and get a stream ID
        const circuitIdBuffer = Buffer.from(circuitId + '\0', 'utf8');
        const targetHostBuffer = Buffer.from(targetHost + '\0', 'utf8');

        const result = this.lib.symbols.arti_connect_stream(
            circuitIdBuffer,
            targetHostBuffer,
            targetPort,
            streamIdBuffer,
            streamIdBuffer.length
        );

        if (result !== 1) {
            throw new Error(`Failed to connect stream to ${targetHost}:${targetPort} on circuit ${circuitId}`);
        }

        // Convert the stream ID buffer to a string (null terminated)
        const streamId = streamIdBuffer.toString('utf8').split('\0')[0];
        return streamId;
    }

    async writeStream(streamId: string, data: Uint8Array): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        const streamIdBuffer = Buffer.from(streamId + '\0', 'utf8');
        const result = this.lib.symbols.arti_write_stream(
            streamIdBuffer,
            data,
            data.length
        );

        if (result !== 1) {
            throw new Error(`Failed to write to stream ${streamId}`);
        }
    }

    async flushStream(streamId: string): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        const streamIdBuffer = Buffer.from(streamId + '\0', 'utf8');
        const result = this.lib.symbols.arti_flush_stream(streamIdBuffer);

        if (result !== 1) {
            throw new Error(`Failed to flush stream ${streamId}`);
        }
    }

    async readStream(streamId: string, maxBytes: number): Promise<Uint8Array> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        // Create a buffer to receive the data
        const buffer = Buffer.alloc(maxBytes);
        const bytesReadBuffer = new Int32Array(1);

        const streamIdBuffer = Buffer.from(streamId + '\0', 'utf8');
        const result = this.lib.symbols.arti_read_stream(
            streamIdBuffer,
            buffer,
            buffer.length,
            ptr(bytesReadBuffer)
        );

        if (result !== 1) {
            throw new Error(`Failed to read from stream ${streamId}`);
        }

        // Get the number of bytes read
        const bytesRead = bytesReadBuffer[0];

        // Return a copy of the buffer with just the bytes that were read
        return buffer.subarray(0, bytesRead);
    }

    async closeStream(streamId: string): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        const streamIdBuffer = Buffer.from(streamId + '\0', 'utf8');
        const result = this.lib.symbols.arti_close_stream(streamIdBuffer);

        if (result !== 1) {
            throw new Error(`Failed to close stream ${streamId}`);
        }
    }
}

/**
 * Get an Arti client instance
 * @param options Options for the Arti client
 * @returns An ArtiClient instance
 */
export function getArtiClient(options?: ArtiClientOptions): ArtiClient {
    const binaryPath = getArtiBinaryPath();
    return new BunArtiClient(binaryPath, options);
}
