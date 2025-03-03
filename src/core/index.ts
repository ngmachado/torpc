/**
 * Core module for Tor integration and circuit management
 */
import { Circuit, CircuitManager, ChainType, CircuitOptions } from '../types';
import { ArtiClient, getArtiClient } from '../bindings';
import crypto from 'crypto';

/**
 * Implementation of the CircuitManager interface that handles Tor circuit creation and management
 */
export class TorCircuitManager implements CircuitManager {
    private circuits: Map<string, Circuit> = new Map();
    private artiClient: ArtiClient;
    private options: CircuitOptions;
    private rotationTimers: Map<string, any> = new Map();

    /**
     * Create a new TorCircuitManager
     * @param options Options for circuit management
     */
    constructor(options: CircuitOptions = {
        isolationLevel: 'chain',
        rotationInterval: 600000, // 10 minutes
        useGuards: true
    }) {
        this.options = options;
        this.artiClient = getArtiClient();
        this.initialize();
    }

    /**
     * Initialize the circuit manager
     */
    private async initialize(): Promise<void> {
        try {
            await this.artiClient.connect();
        } catch (error) {
            console.error('Failed to initialize Tor client:', error);
        }
    }

    /**
     * Generate a circuit key based on isolation level
     * @param chain Optional chain for isolation
     * @param contract Optional contract for isolation
     * @returns Circuit key
     */
    private getCircuitKey(chain?: ChainType, contract?: string): string {
        switch (this.options.isolationLevel) {
            case 'none':
                return 'global';
            case 'chain':
                return chain || 'default';
            case 'contract':
                if (chain && contract) {
                    return `${chain}:${contract}`;
                }
                return chain || 'default';
            default:
                return 'global';
        }
    }

    /**
     * Create a new Tor circuit
     * @param chain Optional chain for isolation
     * @param contract Optional contract for isolation
     * @returns New circuit
     */
    async createCircuit(chain?: ChainType, contract?: string): Promise<Circuit> {
        const circuitKey = this.getCircuitKey(chain, contract);
        const circuitId = `circuit-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;

        // Create the circuit in Tor
        await this.artiClient.createCircuit(circuitId);

        // Create the circuit object
        const circuit: Circuit = {
            id: circuitId,
            createdAt: Date.now(),
            lastUsed: Date.now(),
            chain,
            contract
        };

        // Store the circuit
        this.circuits.set(circuitKey, circuit);

        // Set up rotation timer if needed
        if (this.options.rotationInterval > 0) {
            // Clear any existing timer
            if (this.rotationTimers.has(circuitKey)) {
                clearTimeout(this.rotationTimers.get(circuitKey));
            }

            // Set new timer
            const timer = setTimeout(() => {
                this.rotateCircuit(circuit).catch(error => {
                    console.error(`Failed to rotate circuit ${circuitId}:`, error);
                });
            }, this.options.rotationInterval);

            this.rotationTimers.set(circuitKey, timer);
        }

        return circuit;
    }

    /**
     * Get an existing circuit or create a new one
     * @param chain Optional chain for isolation
     * @param contract Optional contract for isolation
     * @returns Existing or new circuit
     */
    async getCircuit(chain?: ChainType, contract?: string): Promise<Circuit> {
        const circuitKey = this.getCircuitKey(chain, contract);

        // Check if we have an existing circuit
        const existingCircuit = this.circuits.get(circuitKey);
        if (existingCircuit) {
            return existingCircuit;
        }

        // Create a new circuit
        return this.createCircuit(chain, contract);
    }

    /**
     * Rotate a circuit to get a new identity
     * @param circuit Circuit to rotate
     * @returns New circuit
     */
    async rotateCircuit(circuit: Circuit): Promise<Circuit> {
        const circuitKey = this.getCircuitKey(circuit.chain, circuit.contract);

        // Destroy the old circuit
        await this.destroyCircuit(circuit);

        // Create a new circuit
        return this.createCircuit(circuit.chain, circuit.contract);
    }

    /**
     * Destroy a circuit
     * @param circuit Circuit to destroy
     */
    async destroyCircuit(circuit: Circuit): Promise<void> {
        const circuitKey = this.getCircuitKey(circuit.chain, circuit.contract);

        // Clear any rotation timer
        if (this.rotationTimers.has(circuitKey)) {
            clearTimeout(this.rotationTimers.get(circuitKey));
            this.rotationTimers.delete(circuitKey);
        }

        // Remove from our circuits map
        this.circuits.delete(circuitKey);

        // Destroy the circuit in Tor
        await this.artiClient.destroyCircuit(circuit.id);
    }

    /**
     * Clean up resources
     */
    async cleanup(): Promise<void> {
        // Clear all timers
        for (const timer of this.rotationTimers.values()) {
            clearTimeout(timer);
        }
        this.rotationTimers.clear();

        // Destroy all circuits
        for (const circuit of this.circuits.values()) {
            await this.artiClient.destroyCircuit(circuit.id);
        }
        this.circuits.clear();
    }
}
