const cds = require("@sap/cds");

// Load the service module early so its bootstrap handlers are registered
// before cds.server starts listening.
require("./cap-service");

/**
 * Fix: CF GoRouter keeps TCP connections open for 120s+ but Node.js defaults
 * keepAliveTimeout to 5s. When Node closes the socket before GoRouter does,
 * the next request on that connection gets "endpoint_failure (EOF)" → 502/503.
 * Setting keepAliveTimeout > 120s ensures server outlasts GoRouter's idle timeout.
 */
cds.on("listening", ({ server }) => {
    server.keepAliveTimeout = 161000; // 161s > CF GoRouter 120s idle timeout
    server.headersTimeout = 162000;   // Must be strictly > keepAliveTimeout
});

module.exports = cds.server;
