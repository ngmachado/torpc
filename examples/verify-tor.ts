/**
 * Verification script to test Tor connectivity
 * 
 * This script verifies that requests are actually going through Tor
 * by comparing your real IP address with the one seen through Tor
 * from multiple independent sources.
 */

import { getArtiClient } from '../src/bindings';

async function verifyTor() {
    console.log('TORPC VERIFICATION TEST');
    console.log('=======================');
    console.log('This test verifies that requests are truly going through Tor');
    console.log('by comparing your real IP address with the one seen through Tor from multiple sources.\n');

    try {
        // Step 1: Get real IP address
        console.log('1️⃣ Checking your real IP address...');
        const realResponse = await fetch('https://api.ipify.org?format=json');
        const realData = await realResponse.json();
        const realIP = realData.ip;
        console.log(`   Your real IP address: ${realIP}\n`);

        // Step 2: Connect to Tor
        console.log('2️⃣ Connecting to Tor network...');
        try {
            const client = getArtiClient({ verbose: true });
            await client.connect();
            console.log('   ✅ Connected to Tor network!\n');

            // Step 3: Create circuit
            console.log('3️⃣ Creating Tor circuit...');
            const circuitId = `verify-circuit-${Date.now()}`;
            await client.createCircuit(circuitId);
            console.log(`   ✅ Circuit "${circuitId}" created\n`);

            // Step 4: Verification from multiple sources
            console.log('4️⃣ Verifying Tor connection from multiple sources:');

            // Try a simple, reliable site first
            console.log('\n   Reliability test: example.com');
            try {
                const exampleResponse = await client.httpRequest(
                    circuitId,
                    'http://example.com',
                    'GET',
                    { 'Accept': 'text/html' }
                );

                console.log(`   Response status: ${exampleResponse.status}`);
                console.log(`   Response contains data: ${exampleResponse.body.length > 0 ? 'Yes ✅' : 'No ❌'}`);
                console.log(`   First 50 chars: "${exampleResponse.body.substring(0, 50)}..."`);
            } catch (error) {
                console.log(`   ❌ ERROR from example.com: ${error}`);
            }

            // Source 1: httpbin.org (HTTP alternative to check.torproject.org)
            console.log('\n   Source 1: httpbin.org');
            try {
                const torResponse = await client.httpRequest(
                    circuitId,
                    'http://httpbin.org/ip',
                    'GET',
                    { 'Accept': 'application/json' }
                );

                console.log(`   Raw response from httpbin.org: "${torResponse.body}"`);

                if (!torResponse.body || torResponse.body.trim() === '') {
                    console.log('   ❌ ERROR: Empty response from httpbin.org');
                } else {
                    try {
                        const torData = JSON.parse(torResponse.body);
                        const torIP = torData.origin;

                        console.log(`   IP as seen by httpbin.org: ${torIP}`);
                        console.log(`   IP differs from real IP: ${realIP !== torIP ? 'Yes ✅' : 'No ❌'}`);

                        if (realIP === torIP) {
                            console.log('\n   ⚠️ WARNING: Your real IP is being exposed!');
                        }
                    } catch (parseError) {
                        console.log(`   ❌ JSON parsing error: ${parseError.message}`);
                        console.log('   This suggests an incomplete or invalid JSON response from httpbin.org.');
                    }
                }
            } catch (error) {
                console.log(`   ❌ ERROR from httpbin.org: ${error}`);
            }

            // Source 2: Another HTTP service
            console.log('\n   Source 2: ifconfig.me');
            try {
                const ipInfoResponse = await client.httpRequest(
                    circuitId,
                    'http://ifconfig.me/ip',
                    'GET',
                    { 'Accept': 'text/plain' }
                );

                console.log(`   Raw response from ifconfig.me: "${ipInfoResponse.body}"`);

                if (!ipInfoResponse.body || ipInfoResponse.body.trim() === '') {
                    console.log('   ❌ ERROR: Empty response from ifconfig.me');
                } else {
                    const ipInfoIP = ipInfoResponse.body.trim();

                    console.log(`   IP as seen by ifconfig.me: ${ipInfoIP}`);
                    console.log(`   IP differs from real IP: ${realIP !== ipInfoIP ? 'Yes ✅' : 'No ❌'}`);

                    if (realIP === ipInfoIP) {
                        console.log('\n   ⚠️ WARNING: Your real IP is being exposed!');
                    }
                }
            } catch (error) {
                console.log(`   ❌ ERROR from ifconfig.me: ${error}`);
            }

            // Step 5: Test circuit isolation
            console.log('\n5️⃣ Testing circuit isolation...');
            const secondCircuitId = `verify-circuit-2-${Date.now()}`;
            await client.createCircuit(secondCircuitId);
            console.log(`   Second circuit "${secondCircuitId}" created`);

            try {
                const responseCircuit1 = await client.httpRequest(
                    circuitId,
                    'http://httpbin.org/ip',
                    'GET',
                    { 'Accept': 'application/json' }
                );

                const responseCircuit2 = await client.httpRequest(
                    secondCircuitId,
                    'http://httpbin.org/ip',
                    'GET',
                    { 'Accept': 'application/json' }
                );

                console.log(`   Raw response from first circuit: "${responseCircuit1.body}"`);
                console.log(`   Raw response from second circuit: "${responseCircuit2.body}"`);

                if (!responseCircuit1.body || responseCircuit1.body.trim() === '') {
                    console.log('   ❌ ERROR: Empty response from first circuit');
                } else if (!responseCircuit2.body || responseCircuit2.body.trim() === '') {
                    console.log('   ❌ ERROR: Empty response from second circuit');
                } else {
                    try {
                        const ipCircuit1 = JSON.parse(responseCircuit1.body).origin;
                        const ipCircuit2 = JSON.parse(responseCircuit2.body).origin;

                        console.log(`   IP through first circuit: ${ipCircuit1}`);
                        console.log(`   IP through second circuit: ${ipCircuit2}`);

                        const differentExitNode = ipCircuit1 !== ipCircuit2;
                        console.log(`   Different exit nodes: ${differentExitNode ? 'Yes ✅' : 'No ❌'}`);

                        if (!differentExitNode) {
                            console.log('   ℹ️ NOTE: It\'s normal to occasionally get the same exit node for different circuits.');
                            console.log('   ℹ️ Try running the test again if you want to see different exit nodes.');
                        }
                    } catch (parseError) {
                        console.log(`   ❌ JSON parsing error: ${parseError.message}`);
                        console.log('   This suggests an incomplete or invalid JSON response from one of the circuits.');
                    }
                }
            } catch (error) {
                console.log(`   ❌ ERROR during circuit isolation test: ${error}`);
            }

            // Step 6: Clean up
            console.log('\n6️⃣ Cleaning up...');
            await client.destroyCircuit(circuitId);
            console.log(`   Circuit "${circuitId}" destroyed`);
            await client.destroyCircuit(secondCircuitId);
            console.log(`   Circuit "${secondCircuitId}" destroyed`);
            await client.disconnect();
            console.log('   Disconnected from Tor network\n');

            // Conclusion
            console.log('===== CONCLUSION =====');
            console.log('✅ Verification complete. If all tests passed, your implementation is working correctly.');
            console.log('NOTE: HTTPS URLs are not supported yet; this test uses HTTP alternatives.\n');

        } catch (error) {
            console.log(`   ❌ ERROR: ${error}\n`);
            console.log('Possible reasons for failure:');
            console.log('1. The Tor binary is not installed or properly built');
            console.log('2. Your network/firewall is blocking Tor connections');
            console.log('\nRecommendations:');
            console.log('- Make sure the Rust library is properly compiled (run `cd rust/arti-ffi && cargo build --release`)');
            console.log('- Check that your network allows Tor connections');
        }
    } catch (error) {
        console.error('ERROR:', error);
    }
}

verifyTor(); 