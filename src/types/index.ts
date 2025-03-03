export type ChainType = 'ethereum' | 'solana' | string;

export interface CircuitOptions {
    isolationLevel: 'none' | 'chain' | 'contract';
    rotationInterval: number; // in milliseconds
    useGuards: boolean;
}

export interface TorRPCConfig {
    providers: {
        [chain in ChainType]: string[];
    };
    circuitOptions?: CircuitOptions;
    bridges?: string[];
    timeout?: number;
}

export interface Circuit {
    id: string;
    createdAt: number;
    lastUsed: number;
    chain?: ChainType;
    contract?: string;
}

export interface RPCRequest {
    method: string;
    params: any[];
    chain: ChainType;
    contract?: string;
}

export interface RPCResponse {
    id: string;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

export interface CircuitManager {
    createCircuit(chain?: ChainType, contract?: string): Promise<Circuit>;
    getCircuit(chain?: ChainType, contract?: string): Promise<Circuit>;
    rotateCircuit(circuit: Circuit): Promise<Circuit>;
    destroyCircuit(circuit: Circuit): Promise<void>;
}

export interface RPCProvider {
    send(request: RPCRequest, circuit: Circuit): Promise<RPCResponse>;
    isAvailable(): Promise<boolean>;
}
