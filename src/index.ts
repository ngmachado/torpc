/**
 * torpc - Privacy-focused RPC wrapper integrating Tor network capabilities for Web3 applications
 */

// Export types
export * from './types';

// Export core functionality
export * from './core';

// Export RPC providers
export * from './rpc';

// Export Arti bindings
export * from './bindings';

// Import components
import { TorRPCConfig, RPCRequest, RPCResponse, ChainType, Circuit } from './types';
import { TorCircuitManager } from './core';
import { createRPCProvider, BaseRPCProvider } from './rpc';
import { getArtiClient, ArtiClient } from './bindings';

/**
 * Main TorRPC class that handles privacy-focused RPC calls over Tor network
 */
export class TorRPC {
    private config: TorRPCConfig;
    private circuitManager: TorCircuitManager;
    private providers: Map<ChainType, BaseRPCProvider[]> = new Map();
    private artiClient: ArtiClient;

    /**
     * Create a new TorRPC instance
     * @param config Configuration for the TorRPC instance
     */
    constructor(config: TorRPCConfig) {
        this.config = this.validateConfig(config);
        this.artiClient = getArtiClient({
            verbose: true // Enable verbose logging
        });
        this.circuitManager = new TorCircuitManager(this.config.circuitOptions);
        this.initializeProviders();
    }

    /**
     * Initialize RPC providers from configuration
     */
    private initializeProviders(): void {
        // Initialize providers for each chain
        Object.entries(this.config.providers).forEach(([chain, urls]) => {
            const chainType = chain as ChainType;
            const providerList: BaseRPCProvider[] = [];

            urls.forEach(url => {
                // Create chain-specific provider using the factory function
                const provider = createRPCProvider(chainType, url, this.config.timeout);
                providerList.push(provider as BaseRPCProvider);
            });

            this.providers.set(chainType, providerList);
        });
    }

    /**
     * Validate the provided configuration
     * @param config User-provided configuration
     * @returns Validated configuration with defaults applied
     */
    private validateConfig(config: TorRPCConfig): TorRPCConfig {
        // Default configuration values
        return {
            ...config,
            circuitOptions: {
                isolationLevel: 'chain',
                rotationInterval: 600000, // 10 minutes
                useGuards: true,
                ...config.circuitOptions
            },
            timeout: config.timeout || 30000, // 30 seconds default timeout
        };
    }

    /**
     * Send an RPC request through Tor network
     * @param method RPC method name
     * @param params Method parameters
     * @param chain Target blockchain
     * @param contract Optional contract address for isolation
     * @returns RPC response
     */
    async send(
        method: string,
        params: any[],
        chain: ChainType = 'ethereum',
        contract?: string
    ): Promise<any> {
        // Get providers for the specified chain
        const chainProviders = this.providers.get(chain);
        if (!chainProviders || chainProviders.length === 0) {
            throw new Error(`No providers configured for chain: ${chain}`);
        }

        // Get or create a circuit based on isolation level
        const circuit = await this.circuitManager.getCircuit(
            this.config.circuitOptions?.isolationLevel !== 'none' ? chain : undefined,
            this.config.circuitOptions?.isolationLevel === 'contract' ? contract : undefined
        );

        // Create the RPC request
        const request: RPCRequest = {
            method,
            params,
            chain,
            contract
        };

        // Try each provider until one succeeds
        const errors = [];
        for (const provider of chainProviders) {
            try {
                // Check if provider is available
                const isAvailable = await provider.isAvailable();
                if (!isAvailable) {
                    errors.push(`Provider not available`);
                    continue;
                }

                // Send the request
                const response = await provider.send(request, circuit);

                // Update last used timestamp
                circuit.lastUsed = Date.now();

                // Check for errors in the response
                if (response.error) {
                    errors.push(response.error.message);
                    continue;
                }

                return response.result;
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }

        // If we get here, all providers failed
        throw new Error(`All providers failed: ${errors.join(', ')}`);
    }

    /**
     * Initialize the Tor connection
     */
    async initialize(): Promise<void> {
        await this.artiClient.connect();
    }

    /**
     * Disconnect and clean up resources
     */
    async disconnect(): Promise<void> {
        await this.artiClient.disconnect();
        if (this.circuitManager instanceof TorCircuitManager) {
            await (this.circuitManager as TorCircuitManager).cleanup();
        }
    }
}
