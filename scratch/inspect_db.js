const cds = require('@sap/cds');

async function run() {
    const db = await cds.connect.to('db');
    
    console.log("Checking CURRENT_SCHEMA...");
    const currentSchema = await db.run("SELECT CURRENT_SCHEMA FROM DUMMY");
    console.log("Current schema:", currentSchema);
    
    console.log("Checking SYS.TABLES for ZSCHEMA tables in TBL_MNT_HDI...");
    const tables = await db.run("SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = 'TBL_MNT_HDI' AND TABLE_NAME LIKE 'ZSCHEMA%'");
    console.log("Tables found in SYS.TABLES:", tables);

    console.log("Checking SYS.OBJECTS for ZSCHEMA objects in TBL_MNT_HDI...");
    const objects = await db.run("SELECT OBJECT_NAME, OBJECT_TYPE FROM SYS.OBJECTS WHERE SCHEMA_NAME = 'TBL_MNT_HDI' AND OBJECT_NAME LIKE 'ZSCHEMA%'");
    console.log("Objects found in SYS.OBJECTS:", objects);
}

run().catch(console.error);
