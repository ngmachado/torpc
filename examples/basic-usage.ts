/**
 * Basic usage example for TorPC
 * 
 * This example demonstrates how to use TorPC to make HTTP and HTTPS requests through Tor
 */

import { getArtiClient } from '../src/bindings';
import path from 'path';

// Configuration path for Arti
const configPath = path.join(process.cwd(), 'rust/arti-ffi/arti.toml');

console.log("Starting Tor client with configuration:", configPath);

// Get the Arti client with configuration
const client = getArtiClient({
    verbose: true,
    configPath
});

// Circuit IDs for this example
const httpCircuitId = `http-example-${Date.now()}`;
const httpsCircuitId = `https-example-${Date.now()}`;

// Main function
async function main() {
    try {
        // Connect to Tor network
        console.log("Initializing Tor client...");
        await client.connect();
        console.log("Connected to Tor network");

        // First, demonstrate HTTP request
        console.log("\n=== HTTP REQUEST DEMO ===");

        // Create a circuit for HTTP
        console.log(`Creating circuit: ${httpCircuitId}`);
        await client.createCircuit(httpCircuitId);
        console.log(`Circuit created: ${httpCircuitId}`);

        // Make an HTTP request through Tor
        console.log("Making HTTP request through Tor...");
        const httpResponse = await client.httpRequest(
            httpCircuitId,
            "http://httpbin.org/get",
            "GET",
            { "Accept": "application/json" }
        );

        // Display the HTTP response
        console.log("HTTP Response status:", httpResponse.status);
        console.log("HTTP Response headers:", httpResponse.headers);
        console.log("HTTP Response body:", httpResponse.body);

        // Now, demonstrate HTTPS request
        console.log("\n=== HTTPS REQUEST DEMO ===");

        // Create a circuit for HTTPS
        console.log(`Creating circuit: ${httpsCircuitId}`);
        await client.createCircuit(httpsCircuitId);
        console.log(`Circuit created: ${httpsCircuitId}`);

        // Make an HTTPS request through Tor
        console.log("Making HTTPS request through Tor...");
        const httpsResponse = await client.httpRequest(
            httpsCircuitId,
            "https://httpbin.org/get",
            "GET",
            { "Accept": "application/json" }
        );

        // Display the HTTPS response
        console.log("HTTPS Response status:", httpsResponse.status);
        console.log("HTTPS Response headers:", httpsResponse.headers);
        console.log("HTTPS Response body:", httpsResponse.body);

        // Clean up
        console.log("\nCleaning up...");
        await client.destroyCircuit(httpCircuitId);
        console.log(`Circuit ${httpCircuitId} destroyed`);
        await client.destroyCircuit(httpsCircuitId);
        console.log(`Circuit ${httpsCircuitId} destroyed`);
        await client.disconnect();
        console.log("Disconnected from Tor network");

    } catch (error) {
        console.error("Error:", error);

        // Try to clean up in case of error
        try {
            if (client.isConnected()) {
                await client.destroyCircuit(httpCircuitId);
                await client.destroyCircuit(httpsCircuitId);
                await client.disconnect();
            }
        } catch (e) {
            console.error("Error during cleanup:", e);
        }
    }
}

// Run the example
main(); 