/**
 * Bindings module for Arti (Rust's Tor implementation) integration
 */
import { dlopen, FFIType, ptr, CString, toArrayBuffer } from 'bun:ffi';
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
     * Note: This method now supports both HTTP and HTTPS requests
     * @param circuitId The circuit ID to use for the request
     * @param url The URL to request (can be HTTP or HTTPS)
     * @param method The HTTP method to use
     * @param headers Request headers
     * @param body Optional request body
     * @returns Response object with status, headers, and body
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

    /**
     * Connect a stream to a target through Tor
     * @param circuitId The circuit ID to use
     * @param targetHost The target hostname
     * @param targetPort The target port
     * @returns Stream ID
     */
    connectStream(circuitId: string, targetHost: string, targetPort: number): Promise<string>;

    /**
     * Write data to a stream
     * @param streamId The stream ID
     * @param data The data to write
     */
    writeStream(streamId: string, data: Uint8Array): Promise<void>;

    /**
     * Flush a stream
     * @param streamId The stream ID
     */
    flushStream(streamId: string): Promise<void>;

    /**
     * Read data from a stream
     * @param streamId The stream ID
     * @param maxBytes Maximum number of bytes to read
     * @returns The data read
     */
    readStream(streamId: string, maxBytes: number): Promise<Uint8Array>;

    /**
     * Close a stream
     * @param streamId The stream ID
     */
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
        this.options = options;
        this.verbose = options?.verbose ?? false;

        try {
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
                    args: [FFIType.ptr, FFIType.ptr, FFIType.int, FFIType.ptr, FFIType.int],
                    returns: FFIType.int,
                },
                arti_write_stream: {
                    args: [FFIType.ptr, FFIType.ptr, FFIType.int],
                    returns: FFIType.int,
                },
                arti_flush_stream: {
                    args: [FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_read_stream: {
                    args: [FFIType.ptr, FFIType.ptr, FFIType.int, FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_close_stream: {
                    args: [FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_connect_tls_stream: {
                    args: [FFIType.ptr, FFIType.ptr, FFIType.int, FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_tls_write: {
                    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
                    returns: FFIType.int,
                },
                arti_flush_tls_stream: {
                    args: [FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_tls_read: {
                    args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
                    returns: FFIType.int,
                },
                arti_close_tls_stream: {
                    args: [FFIType.ptr],
                    returns: FFIType.int,
                },
                arti_http_request: {
                    args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.int],
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
            console.error(`Failed to load Arti library: ${error}`);
            throw error;
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

        if (this.verbose) {
            console.log(`Making ${method} request to ${url} through circuit ${circuitId}`);
        }

        // Parse the URL to handle HTTP vs HTTPS appropriately
        const parsedUrl = new URL(url);
        const isHttps = parsedUrl.protocol === 'https:';
        const host = parsedUrl.hostname;
        const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (isHttps ? 443 : 80);
        const path = parsedUrl.pathname + parsedUrl.search;

        try {
            // The better implementation that uses our new Rust FFI function is ready,
            // but we're hitting TypeScript binding issues. For now, let's use the original
            // implementation that works.

            // Connect to the target
            const streamId = await this.connectStream(circuitId, host, port);

            let response: { status: number; headers: Record<string, string>; body: string };
            if (isHttps) {
                // For HTTPS, we need to connect a TLS stream
                const tlsStreamId = await this.connectTlsStream(circuitId, host, port);

                try {
                    // Create HTTP request string
                    const requestString = `${method} ${path} HTTP/1.1\r\nHost: ${host}\r\n`;

                    // Add custom headers
                    let headersString = '';
                    for (const [key, value] of Object.entries(headers)) {
                        headersString += `${key}: ${value}\r\n`;
                    }

                    // Add Content-Length header if body is provided
                    if (body) {
                        headersString += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
                    }

                    // Finalize request with empty line
                    const fullRequest = requestString + headersString + '\r\n' + (body || '');

                    // Write the request to the TLS stream
                    await this.writeTlsStream(tlsStreamId, Buffer.from(fullRequest));

                    // Flush the stream to ensure data is sent
                    await this.flushTlsStream(tlsStreamId);

                    // Read the response
                    let responseData = '';
                    let chunk: Uint8Array;

                    while (true) {
                        chunk = await this.readTlsStream(tlsStreamId, 1024);
                        if (chunk.length === 0) break;

                        responseData += new TextDecoder().decode(chunk);

                        // Check if we have a complete HTTP response
                        if (this.isCompleteHttpResponse(responseData)) {
                            break;
                        }
                    }

                    // Parse the HTTP response
                    response = this.parseHttpResponse(responseData);
                } finally {
                    // Always close the TLS stream when done
                    await this.closeTlsStream(tlsStreamId);
                }
            } else {
                // For HTTP, we use the regular stream
                // Create HTTP request string
                const requestString = `${method} ${path} HTTP/1.1\r\nHost: ${host}\r\n`;

                // Add custom headers
                let headersString = '';
                for (const [key, value] of Object.entries(headers)) {
                    headersString += `${key}: ${value}\r\n`;
                }

                // Add Content-Length header if body is provided
                if (body) {
                    headersString += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
                }

                // Finalize request with empty line
                const fullRequest = requestString + headersString + '\r\n' + (body || '');

                // Write the request to the stream
                await this.writeStream(streamId, Buffer.from(fullRequest));

                // Flush the stream to ensure data is sent
                await this.flushStream(streamId);

                // Read the response
                let responseData = '';
                let chunk: Uint8Array;

                while (true) {
                    chunk = await this.readStream(streamId, 1024);
                    if (chunk.length === 0) break;

                    responseData += new TextDecoder().decode(chunk);

                    // Check if we have a complete HTTP response
                    if (this.isCompleteHttpResponse(responseData)) {
                        break;
                    }
                }

                // Parse the HTTP response
                response = this.parseHttpResponse(responseData);
            }

            // Close the stream
            await this.closeStream(streamId);

            return response;
        } catch (error) {
            console.error('Error in HTTP request through Tor:', error);
            throw error;
        }
    }

    /**
     * Parse an HTTP response string into status, headers, and body
     */
    private parseHttpResponse(responseText: string): { status: number; headers: Record<string, string>; body: string } {
        // Split the response into headers and body
        const parts = responseText.split('\r\n\r\n', 2);
        const headersText = parts[0];
        const body = parts.length > 1 ? parts[1] : '';

        // Parse the status line and headers
        const lines = headersText.split('\r\n');
        const statusLine = lines[0];
        const statusMatch = statusLine.match(/HTTP\/\d\.\d\s(\d+)/);
        const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

        // Parse headers
        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const separatorIndex = line.indexOf(':');
            if (separatorIndex > 0) {
                const key = line.substring(0, separatorIndex).trim();
                const value = line.substring(separatorIndex + 1).trim();
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

    /**
     * Connect to a target with TLS through Tor
     */
    async connectTlsStream(circuitId: string, targetHost: string, targetPort: number): Promise<string> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        if (!this.circuits.has(circuitId)) {
            throw new Error(`Circuit "${circuitId}" does not exist`);
        }

        // Create a buffer to receive the stream ID (1024 bytes should be enough)
        const streamIdBuffer = Buffer.alloc(1024);

        if (this.verbose) {
            console.log(`Connecting TLS stream to ${targetHost}:${targetPort} via circuit ${circuitId}`);
        }

        // Connect to the target through Tor with TLS
        const circuitIdBuffer = Buffer.from(circuitId + '\0', 'utf8');
        const targetHostBuffer = Buffer.from(targetHost + '\0', 'utf8');

        const result = this.lib.symbols.arti_connect_tls_stream(
            ptr(circuitIdBuffer),
            ptr(targetHostBuffer),
            targetPort,
            ptr(streamIdBuffer),
            streamIdBuffer.length
        );

        if (result !== 1) {
            throw new Error(`Failed to connect TLS stream to ${targetHost}:${targetPort} on circuit ${circuitId}`);
        }

        // Extract the stream ID from the buffer (null-terminated string)
        const streamIdStr = streamIdBuffer.toString('utf8').split('\0')[0];

        if (this.verbose) {
            console.log(`TLS Stream connected: ${streamIdStr}`);
        }

        return streamIdStr;
    }

    /**
     * Check if the HTTP response is complete
     * This is used by the HTTPS request handler to determine when to stop reading
     */
    private isCompleteHttpResponse(responseText: string): boolean {
        // If we don't have headers yet, not complete
        if (!responseText.includes('\r\n\r\n')) {
            return false;
        }

        // Extract the headers and body
        const parts = responseText.split('\r\n\r\n', 2);
        const headersText = parts[0];
        const body = parts.length > 1 ? parts[1] : '';

        // Look for content-length header
        const contentLengthMatch = headersText.match(/content-length:\s*(\d+)/i);
        if (contentLengthMatch) {
            const contentLength = parseInt(contentLengthMatch[1], 10);
            return body.length >= contentLength;
        }

        // If we have a response but no content-length, it's either complete or using chunked encoding
        // For simplicity, assume it's complete if we have some body data
        return body.length > 0;
    }

    /**
     * Write data to a TLS stream
     */
    async writeTlsStream(streamId: string, data: Uint8Array): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        const streamIdBuffer = Buffer.from(streamId + '\0', 'utf8');
        const dataBuffer = Buffer.from(data);

        if (this.verbose) {
            console.log(`Writing ${data.length} bytes to TLS stream ${streamId}`);
        }

        const result = this.lib.symbols.arti_tls_write(
            ptr(streamIdBuffer),
            ptr(dataBuffer),
            dataBuffer.length
        );

        if (result !== 1) {
            throw new Error(`Failed to write to TLS stream ${streamId}`);
        }
    }

    /**
     * Flush a TLS stream
     */
    async flushTlsStream(streamId: string): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        const streamIdBuffer = Buffer.from(streamId + '\0', 'utf8');

        if (this.verbose) {
            console.log(`Flushing TLS stream ${streamId}`);
        }

        const result = this.lib.symbols.arti_flush_tls_stream(
            ptr(streamIdBuffer)
        );

        if (result !== 1) {
            throw new Error(`Failed to flush TLS stream ${streamId}`);
        }
    }

    /**
     * Read data from a TLS stream
     */
    async readTlsStream(streamId: string, maxBytes: number): Promise<Uint8Array> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        const streamIdBuffer = Buffer.from(streamId + '\0', 'utf8');
        const buffer = Buffer.alloc(maxBytes);
        const bytesRead = Buffer.alloc(4); // Int buffer

        if (this.verbose) {
            console.log(`Reading up to ${maxBytes} bytes from TLS stream ${streamId}`);
        }

        const result = this.lib.symbols.arti_tls_read(
            ptr(streamIdBuffer),
            ptr(buffer),
            maxBytes,
            ptr(bytesRead)
        );

        if (result !== 1) {
            throw new Error(`Failed to read from TLS stream ${streamId}`);
        }

        const bytesReadValue = new Int32Array(toArrayBuffer(bytesRead))[0];

        if (this.verbose) {
            console.log(`Read ${bytesReadValue} bytes from TLS stream ${streamId}`);
        }

        // Return only the bytes that were actually read
        return buffer.subarray(0, bytesReadValue);
    }

    /**
     * Close a TLS stream
     */
    async closeTlsStream(streamId: string): Promise<void> {
        if (!this.connected) {
            throw new Error('Not connected to Tor network');
        }

        const streamIdBuffer = Buffer.from(streamId + '\0', 'utf8');

        if (this.verbose) {
            console.log(`Closing TLS stream ${streamId}`);
        }

        const result = this.lib.symbols.arti_close_tls_stream(
            ptr(streamIdBuffer)
        );

        if (result !== 1) {
            throw new Error(`Failed to close TLS stream ${streamId}`);
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
