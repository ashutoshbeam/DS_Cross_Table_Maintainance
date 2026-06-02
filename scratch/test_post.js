async function main() {
    const url = 'http://localhost:4004/api/schema-browser/tables/ZSCHEMA_VALIDATION_RULES/rows';
    const payload = {
        data: {
            SCHEMA_NAME: '0BB73C680B454936867B03141EA16AB7',
            TABLE_NAME: 'ZPLANT_LOCATION',
            COLUMN_NAME: 'PLANT',
            RULE_TYPE: 'REGEX',
            RULE_VALUE: '^[0-9]{4}$',
            ERROR_MESSAGE: 'Plant must be 4 digits.'
        }
    };
    
    console.log("Sending POST to:", url);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic YWRtaW46' // admin:
            },
            body: JSON.stringify(payload)
        });
        
        console.log("Status:", res.status);
        const text = await res.text();
        console.log("Response:", text);
    } catch(err) {
        console.error("Request failed:", err);
    }
}

main();
