#include <cstdarg>
#include <cstdint>
#include <cstdlib>
#include <ostream>
#include <new>

extern "C" {

/// Initialize the Arti Tor client with a default configuration
///
/// This function must be called before any other functions.
///
/// @return 1 on success, 0 on failure
int arti_init();

/// Initialize the Arti Tor client with a custom configuration file
///
/// This function must be called before any other functions.
///
/// @param config_path A null-terminated string containing the path to the configuration file
/// @return 1 on success, 0 on failure
int arti_init_with_config(const char *config_path);

/// Creates a new Tor circuit with the given ID
///
/// @param circuit_id A null-terminated string representing a unique circuit ID
/// @return 1 on success, 0 on failure
int arti_create_circuit(const char *circuit_id);

/// Destroys an existing Tor circuit
///
/// @param circuit_id A null-terminated string representing a unique circuit ID
/// @return 1 on success, 0 on failure
int arti_destroy_circuit(const char *circuit_id);

/// Connects to the Tor network
///
/// @return 1 on success, 0 on failure
int arti_connect();

/// Disconnects from the Tor network
///
/// @return 1 on success, 0 on failure
int arti_disconnect();

/// Checks if connected to the Tor network
///
/// @return 1 if connected, 0 if not connected
int arti_is_connected();

/// Connect to a target through Tor and return a stream ID
///
/// @param circuit_id The circuit ID to use
/// @param target_host The target hostname
/// @param target_port The target port
/// @param stream_id Output parameter that will receive a null-terminated string representing the stream ID
/// @param stream_id_len Maximum length of the stream ID buffer
/// @return 1 on success, 0 on failure
int arti_connect_stream(const char *circuit_id,
                        const char *target_host,
                        int32_t target_port,
                        char *stream_id,
                        int stream_id_len);

/// Write data to a stream
///
/// @param stream_id The stream ID
/// @param data The data to write
/// @param data_len The length of the data
/// @return 1 on success, 0 on failure
int arti_write_stream(const char *stream_id, const char *data, int data_len);

/// Flush a stream
///
/// @param stream_id The stream ID
/// @return 1 on success, 0 on failure
int arti_flush_stream(const char *stream_id);

/// Read data from a stream
///
/// @param stream_id The stream ID
/// @param buffer The buffer to store the data
/// @param buffer_len The maximum length of the buffer
/// @param bytes_read Output parameter that will receive the number of bytes read
/// @return 1 on success, 0 on failure
int arti_read_stream(const char *stream_id, char *buffer, int buffer_len, int *bytes_read);

/// Close and destroy a stream
///
/// @param stream_id The stream ID
/// @return 1 on success, 0 on failure
int arti_close_stream(const char *stream_id);

} // extern "C"
