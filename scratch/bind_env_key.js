const { execSync } = require('child_process');
const fs = require('fs');

try {
    console.log("Fetching CF service key...");
    const output = execSync('cf service-key table-maintenance-hdi SharedDevKey', { encoding: 'utf8' });
    
    // Find the JSON block start
    const jsonStart = output.indexOf('{');
    if (jsonStart === -1) {
        throw new Error("Could not find JSON block in cf service-key output");
    }
    
    const credentialsJson = JSON.parse(output.slice(jsonStart));
    
    // Format default-env.json structure
    const defaultEnv = {
        VCAP_SERVICES: {
            hana: [
                {
                    name: "table-maintenance-hdi",
                    instance_name: "table-maintenance-hdi",
                    label: "hana",
                    tags: [
                        "hana",
                        "database",
                        "relational",
                        "cap-resource-name:db",
                        "endpoint:https://api.cf.us21.hana.ondemand.com",
                        "org:sgs-apps-dev",
                        "space:TABLE_MAINTENANCE"
                    ],
                    plan: "hdi-shared",
                    credentials: credentialsJson.credentials
                }
            ]
        },
        cds_requires: {
            db: {
                kind: "hana-cloud"
            }
        }
    };
    
    fs.writeFileSync('default-env.json', JSON.stringify(defaultEnv, null, 2), 'utf8');
    console.log("Successfully generated default-env.json.");
} catch (error) {
    console.error("Failed to generate default-env.json:", error);
    process.exit(1);
}
