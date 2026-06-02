const fs = require('fs');
const path = require('path');

// Load default-env.json
try {
    const envFile = path.resolve(__dirname, '../default-env.json');
    if (fs.existsSync(envFile)) {
        const env = JSON.parse(fs.readFileSync(envFile, 'utf-8'));
        if (env.VCAP_SERVICES) {
            process.env.VCAP_SERVICES = JSON.stringify(env.VCAP_SERVICES);
            console.log("Loaded VCAP_SERVICES from default-env.json");
        }
    }
} catch (err) {
    console.error("Error loading default-env.json:", err.message);
}

const cds = require("@sap/cds");

async function main() {
    console.log("Connecting to db...");
    const db = await cds.connect.to("db");
    console.log("Connected. Querying schemas...");
    const schemas = await db.run(`SELECT CURRENT_SCHEMA FROM DUMMY`);
    console.log("Current schema:", schemas);
    
    const schemaName = schemas[0].CURRENT_SCHEMA;

    // Check tables starting with ZSCHEMA_
    const tables = await db.run(`
        SELECT TABLE_NAME 
        FROM SYS.TABLES 
        WHERE SCHEMA_NAME = ?
    `, [schemaName]);
    console.log("Tables in schema:", tables.filter(t => t.TABLE_NAME.startsWith("ZSCHEMA_")));

    // Print columns of ZSCHEMA_VALIDATION_RULES
    try {
        const cols = await db.run(`
            SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, IS_NULLABLE
            FROM SYS.TABLE_COLUMNS
            WHERE SCHEMA_NAME = ? AND TABLE_NAME = 'ZSCHEMA_VALIDATION_RULES'
            ORDER BY POSITION
        `, [schemaName]);
        console.log("ZSCHEMA_VALIDATION_RULES columns:", cols);
    } catch(err) {
        console.error("Error reading ZSCHEMA_VALIDATION_RULES columns:", err.message);
    }

    // Print rows of ZSCHEMA_VALIDATION_RULES
    try {
        const rows = await db.run(`SELECT * FROM ${schemaName}.ZSCHEMA_VALIDATION_RULES`);
        console.log("ZSCHEMA_VALIDATION_RULES rows:", rows);
    } catch(err) {
        console.error("Error reading validation rules:", err.message);
    }
    
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
