const { execSync } = require('child_process');
const fs = require('fs');

try {
    console.log("Fetching CF env...");
    const output = execSync('cf env ZTableMaintenance-srv', { encoding: 'utf8' });
    
    // Extract VCAP_SERVICES JSON block
    const startIdx = output.indexOf('System-Provided:');
    if (startIdx === -1) {
        throw new Error("Could not find System-Provided section in cf env output");
    }
    
    // Find the VCAP_SERVICES JSON block start
    const jsonStart = output.indexOf('{', startIdx);
    // Find matching closing bracket for VCAP_SERVICES JSON block
    let openBrackets = 0;
    let jsonEnd = -1;
    for (let i = jsonStart; i < output.length; i++) {
        if (output[i] === '{') openBrackets++;
        if (output[i] === '}') {
            openBrackets--;
            if (openBrackets === 0) {
                jsonEnd = i + 1;
                break;
            }
        }
    }
    
    if (jsonEnd === -1) {
        throw new Error("Could not parse VCAP_SERVICES JSON structure");
    }
    
    const vcapServicesStr = output.slice(jsonStart, jsonEnd);
    const vcapServices = JSON.parse(vcapServicesStr);
    
    // Format default-env.json structure
    const defaultEnv = {
        VCAP_SERVICES: vcapServices,
        cds_requires: {
            db: {
                kind: "hana-cloud"
            }
        }
    };
    
    // Rename any instances of training-hdi to table-maintenance-hdi
    if (defaultEnv.VCAP_SERVICES.hana) {
        defaultEnv.VCAP_SERVICES.hana.forEach(service => {
            if (service.name === 'training-hdi') {
                service.name = 'table-maintenance-hdi';
                service.instance_name = 'table-maintenance-hdi';
            }
        });
    }
    
    fs.writeFileSync('default-env.json', JSON.stringify(defaultEnv, null, 2), 'utf8');
    console.log("Successfully updated default-env.json with correctly escaped credentials.");
} catch (error) {
    console.error("Failed to generate default-env.json:", error);
    process.exit(1);
}
