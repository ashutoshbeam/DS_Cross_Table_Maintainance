const cds = require("@sap/cds");

// Load the service module early so its bootstrap handlers are registered
// before cds.server starts listening.
require("./cap-service");

module.exports = cds.server;
