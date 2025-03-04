// FFI bindings for Arti to be used by torpc.
// 
// This library provides a C-compatible API for using Arti (Rust Tor implementation)
// from JavaScript/TypeScript through Bun's FFI capabilities.

use std::ffi::{CStr, CString};
use std::collections::HashMap;
use std::sync::Mutex;
use std::os::raw::{c_char, c_int};
use std::sync::Arc;
use std::path::Path;
use std::fs::File;
use std::io::Read;

use arti_client::{TorClient, TorClientConfig, DataStream};
use tokio::runtime::{Runtime, Builder};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tor_rtcompat::PreferredRuntime;
use anyhow::{Result, anyhow};
use lazy_static::lazy_static;
use tokio::io::AsyncRead;
use tokio::io::AsyncWrite;
use tokio_rustls::{TlsConnector, rustls::ClientConfig};
use std::sync::Arc as StdArc;
use rustls::ServerName;
use tokio_rustls::client::TlsStream;
use std::str::FromStr;
use rustls::RootCertStore;
use webpki_roots::TLS_SERVER_ROOTS;
use std::cell::RefCell;
use reqwest;
use serde_json;

// Constants
const ARTI_FFI_SUCCESS: c_int = 1;
const ARTI_FFI_ERROR: c_int = 0;

// Original error constants
const SUCCESS: c_int = 0;
const ERR_NOT_INITIALIZED: c_int = -1;
const ERR_CONNECTION_FAILED: c_int = -2;
const ERR_CIRCUIT_FAILED: c_int = -3;
const ERR_INVALID_PARAMS: c_int = -4;
const ERR_INTERNAL: c_int = -5;

// Default SOCKS port used by the Tor client
const TOR_SOCKS_PORT: u16 = 9050;

// Global state to manage TorClient instances and circuits
lazy_static! {
    static ref CLIENT: Mutex<Option<TorClient<PreferredRuntime>>> = Mutex::new(None);
    static ref CIRCUITS: Mutex<HashMap<String, Arc<TorClient<PreferredRuntime>>>> = Mutex::new(HashMap::new());
    static ref RUNTIME: Mutex<Option<Runtime>> = Mutex::new(None);
    static ref STREAMS: Mutex<HashMap<String, DataStream>> = Mutex::new(HashMap::new());
    static ref TLS_CLIENT_CONFIG: StdArc<ClientConfig> = create_tls_config();
}

// Define TLS_STREAMS as a thread-local HashMap of Mutex-protected TLS streams
thread_local! {
    static TLS_STREAMS: RefCell<HashMap<String, StdArc<Mutex<TlsStream<DataStream>>>>> = RefCell::new(HashMap::new());
}

// Create TLS configuration with system root certificates
fn create_tls_config() -> StdArc<ClientConfig> {
    let mut root_store = RootCertStore::empty();
    
    // Add Mozilla's root certificates
    root_store.add_server_trust_anchors(
        webpki_roots::TLS_SERVER_ROOTS
            .0
            .iter()
            .map(|ta| {
                rustls::OwnedTrustAnchor::from_subject_spki_name_constraints(
                    ta.subject,
                    ta.spki,
                    ta.name_constraints,
                )
            })
    );
    
    let tls_config = ClientConfig::builder()
        .with_safe_defaults()
        .with_root_certificates(root_store)
        .with_no_client_auth();
    
    StdArc::new(tls_config)
}

/// Initialize the Arti Tor client with a default configuration
/// 
/// This function must be called before any other functions.
/// 
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_init() -> c_int {
    let result = initialize_tor_client(None);
    match result {
        Ok(_) => 1,
        Err(e) => {
            eprintln!("Failed to initialize Tor client: {:?}", e);
            0
        },
    }
}

/// Initialize the Arti Tor client with a custom configuration file
/// 
/// This function must be called before any other functions.
/// 
/// @param config_path A null-terminated string containing the path to the configuration file
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_init_with_config(config_path: *const c_char) -> c_int {
    if config_path.is_null() {
        return arti_init();
    }

    let c_str = unsafe { CStr::from_ptr(config_path) };
    let config_path_str = match c_str.to_str() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Failed to convert config path to string");
            return 0;
        }
    };

    let result = initialize_tor_client(Some(config_path_str));
    match result {
        Ok(_) => 1,
        Err(e) => {
            eprintln!("Failed to initialize Tor client with config: {:?}", e);
            0
        },
    }
}

/// Creates a new Tor circuit with the given ID
///
/// @param circuit_id A null-terminated string representing a unique circuit ID
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_create_circuit(circuit_id: *const c_char) -> c_int {
    if circuit_id.is_null() {
        return 0;
    }

    let circuit_id_str = unsafe {
        match CStr::from_ptr(circuit_id).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => return 0,
        }
    };

    match create_circuit(circuit_id_str) {
        Ok(_) => 1,
        Err(_) => 0,
    }
}

/// Destroys an existing Tor circuit
///
/// @param circuit_id A null-terminated string representing a unique circuit ID
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_destroy_circuit(circuit_id: *const c_char) -> c_int {
    if circuit_id.is_null() {
        return 0;
    }

    let circuit_id_str = unsafe {
        match CStr::from_ptr(circuit_id).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => return 0,
        }
    };

    match destroy_circuit(circuit_id_str) {
        Ok(_) => 1,
        Err(_) => 0,
    }
}

/// Connects to the Tor network
///
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_connect() -> c_int {
    match bootstrap_tor() {
        Ok(_) => 1,
        Err(_) => 0,
    }
}

/// Disconnects from the Tor network
///
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_disconnect() -> c_int {
    match shutdown_tor() {
        Ok(_) => 1,
        Err(_) => 0,
    }
}

/// Checks if connected to the Tor network
///
/// @return 1 if connected, 0 if not connected
#[no_mangle]
pub extern "C" fn arti_is_connected() -> c_int {
    match is_connected() {
        Ok(true) => 1,
        _ => 0,
    }
}

/// Connect to a target through Tor and return a stream ID
///
/// @param circuit_id The circuit ID to use
/// @param target_host The target hostname
/// @param target_port The target port
/// @param stream_id Output parameter that will receive a null-terminated string representing the stream ID
/// @param stream_id_len Maximum length of the stream ID buffer
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_connect_stream(
    circuit_id: *const c_char,
    target_host: *const c_char,
    target_port: i32,
    stream_id: *mut c_char,
    stream_id_len: c_int,
) -> c_int {
    if circuit_id.is_null() || target_host.is_null() || stream_id.is_null() || target_port <= 0 {
        eprintln!("Invalid parameters in arti_connect_stream");
        return 0;
    }

    let c_str_circuit = unsafe { CStr::from_ptr(circuit_id) };
    let circuit_id_str = match c_str_circuit.to_str() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Invalid circuit ID string");
            return 0;
        }
    };

    let c_str_host = unsafe { CStr::from_ptr(target_host) };
    let host_str = match c_str_host.to_str() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Invalid host string");
            return 0;
        }
    };

    // Generate a unique stream ID
    let stream_id_str = format!("{}-stream-{}", circuit_id_str, std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis());

    // Convert the stream ID to a C string and copy it to the output parameter
    let stream_id_cstring = match CString::new(stream_id_str.clone()) {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Failed to create stream ID C string");
            return 0;
        }
    };

    let stream_id_bytes = stream_id_cstring.as_bytes_with_nul();
    if stream_id_bytes.len() > stream_id_len as usize {
        eprintln!("Stream ID buffer too small");
        return 0;
    }

    unsafe {
        std::ptr::copy_nonoverlapping(
            stream_id_bytes.as_ptr(),
            stream_id as *mut u8,
            stream_id_bytes.len(),
        );
    }

    // Connect to the target
    println!("DEBUG - Connecting to {}:{} through Tor", host_str, target_port);
    
    // Get the runtime
    let runtime_mutex = match get_or_create_runtime() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to get runtime: {:?}", e);
            return 0;
        }
    };
    let runtime_guard = match runtime_mutex.lock() {
        Ok(g) => g,
        Err(_) => {
            eprintln!("Failed to lock runtime mutex");
            return 0;
        }
    };
    
    let runtime = match &*runtime_guard {
        Some(r) => r,
        None => {
            eprintln!("Runtime not initialized");
            return 0;
        }
    };

    // Get the circuit
    let circuits = match CIRCUITS.lock() {
        Ok(c) => c,
        Err(_) => {
            eprintln!("Failed to lock circuits mutex");
            return 0;
        }
    };

    let circuit = match circuits.get(circuit_id_str) {
        Some(c) => c.clone(),
        None => {
            eprintln!("Circuit not found: {}", circuit_id_str);
            return 0;
        }
    };

    // Connect to the target and store the stream
    let target = format!("{}:{}", host_str, target_port);
    let connect_result = runtime.block_on(async {
        circuit.connect(target).await
    });

    let stream = match connect_result {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to connect to target: {:?}", e);
            return 0;
        }
    };

    println!("DEBUG - Connected to target through Tor");

    // Store the stream
    let mut streams = match STREAMS.lock() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Failed to lock streams mutex");
            return 0;
        }
    };

    streams.insert(stream_id_str, stream);
    
    1
}

/// Write data to a stream
///
/// @param stream_id The stream ID
/// @param data The data to write
/// @param data_len The length of the data
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_write_stream(
    stream_id: *const c_char,
    data: *const c_char,
    data_len: c_int,
) -> c_int {
    if stream_id.is_null() || data.is_null() || data_len <= 0 {
        eprintln!("Invalid parameters in arti_write_stream");
        return 0;
    }

    let c_str_stream_id = unsafe { CStr::from_ptr(stream_id) };
    let stream_id_str = match c_str_stream_id.to_str() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Invalid stream ID string");
            return 0;
        }
    };

    // Get the runtime
    let runtime_mutex = match get_or_create_runtime() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to get runtime: {:?}", e);
            return 0;
        }
    };
    let runtime_guard = match runtime_mutex.lock() {
        Ok(g) => g,
        Err(_) => {
            eprintln!("Failed to lock runtime mutex");
            return 0;
        }
    };
    
    let runtime = match &*runtime_guard {
        Some(r) => r,
        None => {
            eprintln!("Runtime not initialized");
            return 0;
        }
    };

    // Get the stream
    let mut streams = match STREAMS.lock() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Failed to lock streams mutex");
            return 0;
        }
    };

    let stream = match streams.get_mut(stream_id_str) {
        Some(s) => s,
        None => {
            eprintln!("Stream not found: {}", stream_id_str);
            return 0;
        }
    };

    // Get the data as a slice
    let data_slice = unsafe {
        std::slice::from_raw_parts(data as *const u8, data_len as usize)
    };

    println!("DEBUG - Writing {} bytes to stream", data_len);
    
    // Write the data to the stream
    let write_result = runtime.block_on(async {
        stream.write_all(data_slice).await
    });

    match write_result {
        Ok(_) => 1,
        Err(e) => {
            eprintln!("Failed to write to stream: {:?}", e);
            0
        }
    }
}

/// Flush a stream
///
/// @param stream_id The stream ID
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_flush_stream(
    stream_id: *const c_char,
) -> c_int {
    if stream_id.is_null() {
        eprintln!("Invalid parameters in arti_flush_stream");
        return 0;
    }

    let c_str_stream_id = unsafe { CStr::from_ptr(stream_id) };
    let stream_id_str = match c_str_stream_id.to_str() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Invalid stream ID string");
            return 0;
        }
    };

    // Get the runtime
    let runtime_mutex = match get_or_create_runtime() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to get runtime: {:?}", e);
            return 0;
        }
    };
    let runtime_guard = match runtime_mutex.lock() {
        Ok(g) => g,
        Err(_) => {
            eprintln!("Failed to lock runtime mutex");
            return 0;
        }
    };
    
    let runtime = match &*runtime_guard {
        Some(r) => r,
        None => {
            eprintln!("Runtime not initialized");
            return 0;
        }
    };

    // Get the stream
    let mut streams = match STREAMS.lock() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Failed to lock streams mutex");
            return 0;
        }
    };

    let stream = match streams.get_mut(stream_id_str) {
        Some(s) => s,
        None => {
            eprintln!("Stream not found: {}", stream_id_str);
            return 0;
        }
    };

    println!("DEBUG - Flushing stream");
    
    // Flush the stream
    let flush_result = runtime.block_on(async {
        stream.flush().await
    });

    match flush_result {
        Ok(_) => 1,
        Err(e) => {
            eprintln!("Failed to flush stream: {:?}", e);
            0
        }
    }
}

/// Read data from a stream
///
/// @param stream_id The stream ID
/// @param buffer The buffer to store the data
/// @param buffer_len The maximum length of the buffer
/// @param bytes_read Output parameter that will receive the number of bytes read
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_read_stream(
    stream_id: *const c_char,
    buffer: *mut c_char,
    buffer_len: c_int,
    bytes_read: *mut c_int,
) -> c_int {
    if stream_id.is_null() || buffer.is_null() || buffer_len <= 0 || bytes_read.is_null() {
        eprintln!("Invalid parameters in arti_read_stream");
        return 0;
    }

    let c_str_stream_id = unsafe { CStr::from_ptr(stream_id) };
    let stream_id_str = match c_str_stream_id.to_str() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Invalid stream ID string");
            return 0;
        }
    };

    // Get the runtime
    let runtime_mutex = match get_or_create_runtime() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to get runtime: {:?}", e);
            return 0;
        }
    };
    let runtime_guard = match runtime_mutex.lock() {
        Ok(g) => g,
        Err(_) => {
            eprintln!("Failed to lock runtime mutex");
            return 0;
        }
    };
    
    let runtime = match &*runtime_guard {
        Some(r) => r,
        None => {
            eprintln!("Runtime not initialized");
            return 0;
        }
    };

    // Get the stream
    let mut streams = match STREAMS.lock() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Failed to lock streams mutex");
            return 0;
        }
    };

    let stream = match streams.get_mut(stream_id_str) {
        Some(s) => s,
        None => {
            eprintln!("Stream not found: {}", stream_id_str);
            return 0;
        }
    };

    // Prepare the buffer
    let buffer_slice = unsafe {
        std::slice::from_raw_parts_mut(buffer as *mut u8, buffer_len as usize)
    };

    println!("DEBUG - Reading from stream (max {} bytes)", buffer_len);
    
    // Read from the stream
    let read_result = runtime.block_on(async {
        stream.read(buffer_slice).await
    });

    match read_result {
        Ok(n) => {
            println!("DEBUG - Read {} bytes from stream", n);
            unsafe {
                *bytes_read = n as c_int;
            }
            1
        },
        Err(e) => {
            eprintln!("Failed to read from stream: {:?}", e);
            0
        }
    }
}

/// Close and destroy a stream
///
/// @param stream_id The stream ID
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_close_stream(
    stream_id: *const c_char,
) -> c_int {
    if stream_id.is_null() {
        eprintln!("Invalid parameters in arti_close_stream");
        return 0;
    }

    let c_str_stream_id = unsafe { CStr::from_ptr(stream_id) };
    let stream_id_str = match c_str_stream_id.to_str() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Invalid stream ID string");
            return 0;
        }
    };

    // Remove the stream
    let mut streams = match STREAMS.lock() {
        Ok(s) => s,
        Err(_) => {
            eprintln!("Failed to lock streams mutex");
            return 0;
        }
    };

    if streams.remove(stream_id_str).is_some() {
        println!("DEBUG - Stream closed: {}", stream_id_str);
        1
    } else {
        eprintln!("Stream not found: {}", stream_id_str);
        0
    }
}

// Implement a more straightforward HTTP/HTTPS request function using reqwest
fn http_request(circuit_id: String, url: String, method: String, headers: String, body: String) -> Result<String> {
    // Get the Tor client for this circuit
    let tor_client = match get_tor_client_by_circuit(&circuit_id) {
        Some(client) => client,
        None => return Err(anyhow!("Circuit not found")),
    };
    
    // Configure the reqwest client to use the Tor SOCKS proxy
    // We'll use the default SOCKS port 9050 since we can't easily get it from the TorClient
    let proxy_url = "socks5://127.0.0.1:9050";
    
    // Create a reqwest client with the SOCKS proxy
    let client_builder = reqwest::Client::builder()
        .proxy(reqwest::Proxy::all(proxy_url)?)
        .danger_accept_invalid_certs(false);  // Enforce certificate validation for HTTPS
        
    // Build the client
    let client = client_builder.build()?;
    
    // Parse the headers
    let headers_map: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&headers)?;
    
    // Create the request
    let mut request_builder = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "HEAD" => client.head(&url),
        "PATCH" => client.patch(&url),
        _ => return Err(anyhow!("Unsupported HTTP method: {}", method)),
    };
    
    // Add headers
    for (key, value) in headers_map.iter() {
        if let Some(value_str) = value.as_str() {
            request_builder = request_builder.header(key, value_str);
        }
    }
    
    // Add body if present
    if !body.is_empty() {
        request_builder = request_builder.body(body);
    }
    
    // Send the request and get the response using a new runtime to avoid MutexGuard issues
    let runtime = tokio::runtime::Runtime::new()?;
    
    // Execute the request in the runtime
    let response = runtime.block_on(async {
        request_builder.send().await
            .map_err(|e| anyhow!("Request failed: {}", e))
    })?;
    
    // Get the status code
    let status = response.status().as_u16();
    
    // Get the response headers
    let response_headers = response.headers().iter()
        .map(|(name, value)| {
            let name_str = name.as_str();
            let value_str = value.to_str().unwrap_or("");
            (name_str.to_string(), value_str.to_string())
        })
        .collect::<std::collections::HashMap<String, String>>();
    
    // Read the response body
    let response_body = runtime.block_on(async {
        response.text().await
            .map_err(|e| anyhow!("Failed to read response body: {}", e))
    })?;
    
    // Create the response JSON
    let response_json = serde_json::json!({
        "status": status,
        "headers": response_headers,
        "body": response_body
    });
    
    Ok(response_json.to_string())
}

#[no_mangle]
pub extern "C" fn arti_http_request(
    circuit_id: *const c_char,
    url: *const c_char,
    method: *const c_char,
    headers: *const c_char,
    body: *const c_char,
    response: *mut c_char,
    response_len: c_int,
) -> c_int {
    // Validate parameters
    if circuit_id.is_null() || url.is_null() || method.is_null() || headers.is_null() || body.is_null() || response.is_null() {
        return 0;
    }
    
    // Convert parameters to Rust strings
    let circuit_id_str = unsafe { CStr::from_ptr(circuit_id).to_str().unwrap_or("") }.to_string();
    let url_str = unsafe { CStr::from_ptr(url).to_str().unwrap_or("") }.to_string();
    let method_str = unsafe { CStr::from_ptr(method).to_str().unwrap_or("") }.to_string();
    let headers_str = unsafe { CStr::from_ptr(headers).to_str().unwrap_or("{}") }.to_string();
    let body_str = unsafe { CStr::from_ptr(body).to_str().unwrap_or("") }.to_string();
    
    // Make the HTTP request
    match http_request(circuit_id_str, url_str, method_str, headers_str, body_str) {
        Ok(response_str) => {
            // Copy the response to the provided buffer
            let response_bytes = response_str.as_bytes();
            let max_len = response_len as usize - 1; // Leave space for null terminator
            let copy_len = std::cmp::min(response_bytes.len(), max_len);
            
            unsafe {
                std::ptr::copy_nonoverlapping(
                    response_bytes.as_ptr() as *const c_char,
                    response,
                    copy_len,
                );
                // Add null terminator
                *response.add(copy_len) = 0;
            }
            
            1
        },
        Err(e) => {
            eprintln!("HTTP request failed: {:?}", e);
            0
        }
    }
}

// Rust implementation functions

fn initialize_tor_client(config_path: Option<&str>) -> Result<()> {
    // Get or create the runtime
    let runtime_mutex = get_or_create_runtime()?;
    let runtime_guard = runtime_mutex.lock().unwrap();
    
    if let Some(runtime) = &*runtime_guard {
        // Create the base Tor client configuration 
        let config = TorClientConfig::default();
        
        eprintln!("Using default TorClientConfig");
        
        // We'll print some debug info about the configuration file if provided
        if let Some(path) = config_path {
            eprintln!("Note: Configuration file specified at: {}", path);
            if !Path::new(path).exists() {
                eprintln!("Warning: Configuration file not found: {}", path);
            } else {
                // Just read the file to print its contents for debugging
                match File::open(path) {
                    Ok(mut file) => {
                        let mut contents = String::new();
                        if file.read_to_string(&mut contents).is_ok() {
                            eprintln!("Configuration file content (for reference only):");
                            eprintln!("{}", contents);
                        }
                    },
                    Err(e) => {
                        eprintln!("Warning: Failed to read configuration file: {}", e);
                    }
                }
            }
        } else {
            // Check if we have a default config file in the current directory
            let default_config_path = "arti.toml";
            if Path::new(default_config_path).exists() {
                eprintln!("Found default configuration file at: {}", default_config_path);
                // Just read the file to print its contents for debugging
                match File::open(default_config_path) {
                    Ok(mut file) => {
                        let mut contents = String::new();
                        if file.read_to_string(&mut contents).is_ok() {
                            eprintln!("Default configuration file content (for reference only):");
                            eprintln!("{}", contents);
                        }
                    },
                    Err(e) => {
                        eprintln!("Warning: Failed to read default configuration file: {}", e);
                    }
                }
            }
        }
        
        // Bootstrap the Tor client
        eprintln!("Bootstrapping Tor client...");
        let tor_client = runtime.block_on(TorClient::create_bootstrapped(config))?;
        eprintln!("Tor client bootstrapped successfully");
        
        // Drop the runtime guard before acquiring another lock
        drop(runtime_guard);
        
        // Store the client
        let mut client = CLIENT.lock().unwrap();
        *client = Some(tor_client);
        
        Ok(())
    } else {
        Err(anyhow!("Failed to get Tokio runtime"))
    }
}

fn bootstrap_tor() -> Result<()> {
    let client = CLIENT.lock().unwrap();
    if client.is_none() {
        return Err(anyhow::anyhow!("Tor client not initialized"));
    }
    
    // Client is already bootstrapped when created
    Ok(())
}

fn shutdown_tor() -> Result<()> {
    // First, destroy all circuits
    let mut circuits = CIRCUITS.lock().unwrap();
    circuits.clear();
    
    // Then clear the client
    let mut client = CLIENT.lock().unwrap();
    *client = None;
    
    Ok(())
}

fn is_connected() -> Result<bool> {
    let client = CLIENT.lock().unwrap();
    Ok(client.is_some())
}

fn create_circuit(circuit_id: String) -> Result<()> {
    // Get the Tor client from the global state
    let tor_client = match CLIENT.lock().unwrap().clone() {
        Some(client) => Arc::new(client),
        None => return Err(anyhow!("Tor client not initialized")),
    };
    
    // Store the circuit ID and associated client
    let mut circuits = CIRCUITS.lock().unwrap();
    circuits.insert(circuit_id.clone(), tor_client);
    
    Ok(())
}

fn destroy_circuit(circuit_id: String) -> Result<()> {
    // Remove the circuit ID from the registry
    let mut circuits = CIRCUITS.lock().unwrap();
    if circuits.remove(&circuit_id).is_none() {
        return Err(anyhow!("Circuit not found: {}", circuit_id));
    }
    Ok(())
}

// Helper function to get or create the runtime
fn get_or_create_runtime() -> Result<&'static Mutex<Option<Runtime>>> {
    // Check if runtime exists
    let runtime = RUNTIME.lock().unwrap();
    if runtime.is_none() {
        // Release lock before modifying
        drop(runtime);
        
        // Get lock again and check once more (double-check locking pattern)
        let mut runtime = RUNTIME.lock().unwrap();
        if runtime.is_none() {
            // Create a new runtime
            *runtime = Some(
                Builder::new_multi_thread()
                    .enable_all()
                    .build()
                    .map_err(|e| anyhow!("Failed to create Tokio runtime: {}", e))?
            );
        }
    }
    
    Ok(&RUNTIME)
}

// Helper function to get the Tor client from a circuit ID
fn get_tor_client_by_circuit(circuit_id: &str) -> Option<Arc<TorClient<PreferredRuntime>>> {
    let circuits = CIRCUITS.lock().unwrap();
    circuits.get(circuit_id).cloned()
}

/// Connect to a target through Tor with TLS (HTTPS)
///
/// @param circuit_id The circuit ID to use
/// @param host The target hostname
/// @param port The target port
/// @param stream_id Output parameter that will receive a null-terminated string representing the stream ID
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_connect_tls_stream(
    circuit_id: *const c_char,
    host: *const c_char,
    port: c_int,
    stream_id: *const c_char
) -> c_int {
    if circuit_id.is_null() || host.is_null() || stream_id.is_null() || port <= 0 || port > 65535 {
        eprintln!("Invalid parameters in arti_connect_tls_stream");
        return 0;
    }

    let circuit_id_str = unsafe {
        match CStr::from_ptr(circuit_id).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => {
                eprintln!("Invalid circuit ID string");
                return 0;
            }
        }
    };
    
    let host_str = unsafe {
        match CStr::from_ptr(host).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => {
                eprintln!("Invalid host string");
                return 0;
            }
        }
    };
    
    let stream_id_str = unsafe {
        match CStr::from_ptr(stream_id).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => {
                eprintln!("Invalid stream ID string");
                return 0;
            }
        }
    };
    
    let target_port = port as u16;

    // Get the runtime
    let runtime_mutex = match get_or_create_runtime() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("Failed to get runtime for TLS connection: {:?}", e);
            return 0;
        }
    };
    let runtime_guard = runtime_mutex.lock().unwrap();
    
    if let Some(runtime) = &*runtime_guard {
        // Get the circuit
        let client = match get_tor_client_by_circuit(&circuit_id_str) {
            Some(c) => c,
            None => {
                eprintln!("Circuit not found: {}", circuit_id_str);
                return 0;
            }
        };

        // Connect to the target through Tor
        println!("DEBUG - Connecting to {}:{} through Tor with TLS", host_str, target_port);
        
        let result = runtime.block_on(async {
            // First establish the basic Tor connection
            let target = format!("{}:{}", host_str, target_port);
            let stream = match client.connect(&target).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Failed to connect to target through Tor: {:?}", e);
                    return Err(anyhow!("Connection failed"));
                }
            };
            
            // Now establish TLS connection over the Tor stream
            let server_name = match rustls::ServerName::try_from(host_str.as_str()) {
                Ok(n) => n,
                Err(e) => {
                    eprintln!("Invalid server name for TLS: {:?}", e);
                    return Err(anyhow!("Invalid server name"));
                }
            };
            
            let connector = TlsConnector::from(StdArc::clone(&TLS_CLIENT_CONFIG));
            
            match connector.connect(server_name, stream).await {
                Ok(tls_stream) => {
                    // Store the TLS stream in thread-local storage
                    TLS_STREAMS.with(|streams| {
                        let mut streams_ref = streams.borrow_mut();
                        streams_ref.insert(circuit_id_str.clone(), StdArc::new(Mutex::new(tls_stream)));
                    });
                    Ok(())
                },
                Err(e) => {
                    eprintln!("TLS handshake failed: {:?}", e);
                    Err(anyhow!("TLS handshake failed"))
                }
            }
        });

        match result {
            Ok(_) => {
                println!("TLS connection established: {}", stream_id_str);
                1
            },
            Err(e) => {
                eprintln!("TLS connection failed: {:?}", e);
                0
            }
        }
    } else {
        eprintln!("Runtime not initialized");
        0
    }
}

/// Write data to a TLS stream
///
/// @param stream_id A null-terminated string representing the stream ID
/// @param data Pointer to the data to write
/// @param data_len Length of the data
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_tls_write(
    stream_id: *const c_char,
    data: *const u8,
    data_len: usize
) -> c_int {
    let stream_id_str = unsafe {
        match CStr::from_ptr(stream_id).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => return 0,
        }
    };
    
    let data_slice = unsafe { std::slice::from_raw_parts(data, data_len) };
    
    // Get the runtime
    let runtime_mutex = match get_or_create_runtime() {
        Ok(r) => r,
        Err(_) => return 0,
    };
    let runtime_guard = runtime_mutex.lock().unwrap();
    
    if let Some(runtime) = &*runtime_guard {
        // Get the TLS stream from thread-local storage
        let stream_arc_option = TLS_STREAMS.with(|streams| {
            let streams_ref = streams.borrow();
            streams_ref.get(&stream_id_str).map(StdArc::clone)
        });
        
        if let Some(stream_arc) = stream_arc_option {
            let result = runtime.block_on(async {
                // Get a lock on the TLS stream
                let mut stream = stream_arc.lock().unwrap();
                
                // Write the data to the stream
                match stream.write_all(data_slice).await {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        eprintln!("Failed to write to TLS stream: {:?}", e);
                        Err(anyhow!("Write failed"))
                    }
                }
            });
            
            match result {
                Ok(_) => 1,
                Err(_) => 0,
            }
        } else {
            0
        }
    } else {
        0
    }
}

/// Flush a TLS stream
///
/// @param stream_id A null-terminated string representing the stream ID
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_flush_tls_stream(
    stream_id: *const c_char
) -> c_int {
    let stream_id_str = unsafe {
        match CStr::from_ptr(stream_id).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => return 0,
        }
    };
    
    // Get the runtime
    let runtime_mutex = match get_or_create_runtime() {
        Ok(r) => r,
        Err(_) => return 0,
    };
    let runtime_guard = runtime_mutex.lock().unwrap();
    
    if let Some(runtime) = &*runtime_guard {
        // Get the TLS stream from thread-local storage
        let stream_arc_option = TLS_STREAMS.with(|streams| {
            let streams_ref = streams.borrow();
            streams_ref.get(&stream_id_str).map(StdArc::clone)
        });
        
        if let Some(stream_arc) = stream_arc_option {
            let result = runtime.block_on(async {
                // Get a lock on the TLS stream
                let mut stream = stream_arc.lock().unwrap();
                
                // Flush the stream
                match stream.flush().await {
                    Ok(_) => Ok(()),
                    Err(e) => {
                        eprintln!("Failed to flush TLS stream: {:?}", e);
                        Err(anyhow!("Flush failed"))
                    }
                }
            });
            
            match result {
                Ok(_) => 1,
                Err(_) => 0,
            }
        } else {
            0
        }
    } else {
        0
    }
}

/// Read data from a TLS stream
///
/// @param stream_id A null-terminated string representing the stream ID
/// @param buffer Pointer to the buffer to store the read data
/// @param buffer_len Length of the buffer
/// @param bytes_read Output parameter that will receive the number of bytes read
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_tls_read(
    stream_id: *const c_char,
    buffer: *mut u8,
    buffer_len: usize
) -> c_int {
    let stream_id_str = unsafe {
        match CStr::from_ptr(stream_id).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => return -1,
        }
    };
    
    let buffer_slice = unsafe { std::slice::from_raw_parts_mut(buffer, buffer_len) };
    
    // Get the runtime
    let runtime_mutex = match get_or_create_runtime() {
        Ok(r) => r,
        Err(_) => return -1,
    };
    let runtime_guard = runtime_mutex.lock().unwrap();
    
    if let Some(runtime) = &*runtime_guard {
        // Get the TLS stream from thread-local storage
        let stream_arc_option = TLS_STREAMS.with(|streams| {
            let streams_ref = streams.borrow();
            streams_ref.get(&stream_id_str).map(StdArc::clone)
        });
        
        if let Some(stream_arc) = stream_arc_option {
            let result = runtime.block_on(async {
                // Get a lock on the TLS stream
                let mut stream = stream_arc.lock().unwrap();
                
                // Read data into the buffer
                match stream.read(buffer_slice).await {
                    Ok(n) => Ok(n),
                    Err(e) => {
                        eprintln!("Failed to read from TLS stream: {:?}", e);
                        Err(anyhow!("Read failed"))
                    }
                }
            });
            
            match result {
                Ok(bytes_read) => bytes_read as c_int,
                Err(_) => -1,
            }
        } else {
            -1
        }
    } else {
        -1
    }
}

/// Close a TLS stream
///
/// @param stream_id A null-terminated string representing the stream ID
/// @return 1 on success, 0 on failure
#[no_mangle]
pub extern "C" fn arti_close_tls_stream(
    stream_id: *const c_char
) -> c_int {
    let stream_id_str = unsafe {
        match CStr::from_ptr(stream_id).to_str() {
            Ok(s) => s.to_string(),
            Err(_) => return 0,
        }
    };

    // Remove the stream from the map
    let removed = TLS_STREAMS.with(|streams| {
        let mut streams_mut = streams.borrow_mut();
        streams_mut.remove(&stream_id_str).is_some()
    });
    
    if removed {
        println!("TLS Stream closed: {}", stream_id_str);
        1
    } else {
        println!("TLS Stream not found: {}", stream_id_str);
        0
    }
}
