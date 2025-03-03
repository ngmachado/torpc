/**
 * Basic usage example for TorPC
 * 
 * This example demonstrates how to use TorPC to make HTTP requests through Tor
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

// Circuit ID for this example
const circuitId = `basic-example-${Date.now()}`;

// Main function
async function main() {
    try {
        // Connect to Tor network
        console.log("Initializing Tor client...");
        await client.connect();
        console.log("Connected to Tor network");

        // Create a circuit
        console.log(`Creating circuit: ${circuitId}`);
        await client.createCircuit(circuitId);
        console.log(`Circuit created: ${circuitId}`);

        // Make an HTTP request through Tor
        console.log("Making HTTP request through Tor...");
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

        try {
            // Try to parse the JSON response, but handle errors gracefully
            if (response.body && response.headers["Content-Type"]?.includes("application/json")) {
                const data = JSON.parse(response.body);
                console.log("Parsed response:", data);
            } else {
                console.log("Response is not JSON or is empty.");
            }
        } catch (error) {
            console.error("Error parsing JSON response:", error);
        }

        // Clean up
        console.log("Cleaning up...");
        await client.destroyCircuit(circuitId);
        console.log(`Circuit ${circuitId} destroyed`);
        await client.disconnect();
        console.log("Disconnected from Tor network");

    } catch (error) {
        console.error("Error:", error);

        // Try to clean up in case of error
        try {
            if (client.isConnected()) {
                await client.destroyCircuit(circuitId);
                await client.disconnect();
            }
        } catch (e) {
            console.error("Error during cleanup:", e);
        }
    }
}

// Run the example
main(); 