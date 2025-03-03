/**
 * RPC module for handling RPC requests and provider management
 */
import { RPCProvider, RPCRequest, RPCResponse, Circuit, ChainType } from '../types';
import { getArtiClient } from '../bindings';

/**
 * Error codes for JSON-RPC responses
 */
export enum RPCErrorCode {
    PARSE_ERROR = -32700,
    INVALID_REQUEST = -32600,
    METHOD_NOT_FOUND = -32601,
    INVALID_PARAMS = -32602,
    INTERNAL_ERROR = -32603,
    SERVER_ERROR_RANGE_START = -32000,
    SERVER_ERROR_RANGE_END = -32099,
    PROVIDER_ERROR = -31000,
    NETWORK_ERROR = -31001,
    TIMEOUT_ERROR = -31002
}

/**
 * Base implementation of the RPCProvider interface
 */
export class BaseRPCProvider implements RPCProvider {
    protected url: string;
    protected timeout: number;

    /**
     * Create a new RPC provider
     * @param url Provider URL
     * @param timeout Request timeout in milliseconds
     */
    constructor(url: string, timeout: number = 30000) {
        this.url = url;
        this.timeout = timeout;
    }

    /**
     * Send an RPC request through a specific circuit
     * @param request RPC request
     * @param circuit Tor circuit to use
     * @returns RPC response
     */
    async send(request: RPCRequest, circuit: Circuit): Promise<RPCResponse> {
        try {
            const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

            const rpcRequest = {
                jsonrpc: '2.0',
                id: requestId,
                method: request.method,
                params: request.params
            };

            // Get the ArtiClient instance
            const artiClient = getArtiClient();

            // Set up headers
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };

            // Send the request through Tor
            const torResponse = await artiClient.httpRequest(
                circuit.id,
                this.url,
                'POST',
                headers,
                JSON.stringify(rpcRequest)
            );

            // Check the response status
            if (torResponse.status < 200 || torResponse.status >= 300) {
                return {
                    id: requestId,
                    error: {
                        code: RPCErrorCode.NETWORK_ERROR,
                        message: `HTTP error: ${torResponse.status}`
                    }
                };
            }

            // Parse the response body
            let jsonResponse;
            try {
                jsonResponse = JSON.parse(torResponse.body);
            } catch (error) {
                return {
                    id: requestId,
                    error: {
                        code: RPCErrorCode.PARSE_ERROR,
                        message: 'Invalid JSON response'
                    }
                };
            }

            // Check for JSON-RPC error
            if (jsonResponse.error) {
                return {
                    id: requestId,
                    error: jsonResponse.error
                };
            }

            return {
                id: requestId,
                result: jsonResponse.result
            };

        } catch (error) {
            // Handle errors
            if (error instanceof Error) {
                if (error.name === 'AbortError') {
                    return {
                        id: `error-${Date.now()}`,
                        error: {
                            code: RPCErrorCode.TIMEOUT_ERROR,
                            message: 'Request timed out'
                        }
                    };
                }

                return {
                    id: `error-${Date.now()}`,
                    error: {
                        code: RPCErrorCode.INTERNAL_ERROR,
                        message: error.message
                    }
                };
            }

            return {
                id: `error-${Date.now()}`,
                error: {
                    code: RPCErrorCode.INTERNAL_ERROR,
                    message: 'Unknown error occurred'
                }
            };
        }
    }

    /**
     * Check if the provider is available
     * @returns True if the provider is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            // Get the ArtiClient instance
            const artiClient = getArtiClient();

            // Create a temporary circuit for the healthcheck
            const tempCircuitId = `healthcheck-${Date.now()}`;
            await artiClient.createCircuit(tempCircuitId);

            try {
                // Make a simple RPC call to check availability
                const torResponse = await artiClient.httpRequest(
                    tempCircuitId,
                    this.url,
                    'POST',
                    { 'Content-Type': 'application/json' },
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: 'healthcheck',
                        method: 'net_version',
                        params: []
                    })
                );

                // Clean up the temporary circuit
                await artiClient.destroyCircuit(tempCircuitId);

                // Check if the response is valid
                return torResponse.status >= 200 && torResponse.status < 300;
            } catch (error) {
                // Make sure to clean up the circuit even if the request fails
                await artiClient.destroyCircuit(tempCircuitId);
                return false;
            }
        } catch (error) {
            return false;
        }
    }
}

/**
 * Ethereum-specific RPC provider
 */
export class EthereumRPCProvider extends BaseRPCProvider {
    /**
     * Check if the provider is available
     * @returns True if the provider is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            // Get the ArtiClient instance
            const artiClient = getArtiClient();

            // Create a temporary circuit for the healthcheck
            const tempCircuitId = `healthcheck-${Date.now()}`;
            await artiClient.createCircuit(tempCircuitId);

            try {
                // Make a simple RPC call to check availability
                const torResponse = await artiClient.httpRequest(
                    tempCircuitId,
                    this.url,
                    'POST',
                    { 'Content-Type': 'application/json' },
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: 'healthcheck',
                        method: 'net_version',
                        params: []
                    })
                );

                // Clean up the temporary circuit
                await artiClient.destroyCircuit(tempCircuitId);

                // Check if the response is valid JSON
                if (torResponse.status >= 200 && torResponse.status < 300) {
                    try {
                        const json = JSON.parse(torResponse.body);
                        return json.result !== undefined && !json.error;
                    } catch (e) {
                        return false;
                    }
                }

                return false;
            } catch (error) {
                // Make sure to clean up the circuit even if the request fails
                await artiClient.destroyCircuit(tempCircuitId);
                return false;
            }
        } catch (error) {
            return false;
        }
    }
}

/**
 * Solana-specific RPC provider
 */
export class SolanaRPCProvider extends BaseRPCProvider {
    /**
     * Check if the provider is available
     * @returns True if the provider is available
     */
    async isAvailable(): Promise<boolean> {
        try {
            // Get the ArtiClient instance
            const artiClient = getArtiClient();

            // Create a temporary circuit for the healthcheck
            const tempCircuitId = `healthcheck-${Date.now()}`;
            await artiClient.createCircuit(tempCircuitId);

            try {
                // Make a simple RPC call to check availability
                const torResponse = await artiClient.httpRequest(
                    tempCircuitId,
                    this.url,
                    'POST',
                    { 'Content-Type': 'application/json' },
                    JSON.stringify({
                        jsonrpc: '2.0',
                        id: 'healthcheck',
                        method: 'getVersion',
                        params: []
                    })
                );

                // Clean up the temporary circuit
                await artiClient.destroyCircuit(tempCircuitId);

                // Check if the response is valid JSON
                if (torResponse.status >= 200 && torResponse.status < 300) {
                    try {
                        const json = JSON.parse(torResponse.body);
                        return json.result !== undefined && !json.error;
                    } catch (e) {
                        return false;
                    }
                }

                return false;
            } catch (error) {
                // Make sure to clean up the circuit even if the request fails
                await artiClient.destroyCircuit(tempCircuitId);
                return false;
            }
        } catch (error) {
            return false;
        }
    }
}

/**
 * Factory function to create the appropriate provider for a chain
 * @param chain Chain type
 * @param url RPC URL
 * @param timeout Request timeout
 * @returns Appropriate RPC provider instance
 */
export function createRPCProvider(chain: ChainType, url: string, timeout?: number): RPCProvider {
    switch (chain) {
        case 'ethereum':
            return new EthereumRPCProvider(url, timeout);
        case 'solana':
            return new SolanaRPCProvider(url, timeout);
        default:
            return new BaseRPCProvider(url, timeout);
    }
}
