const https = require('https');
const url = require('url');

const credentials = {
  clientid: "sb-clone461714dd66354202bdd38b083d48fa04!b57962|destination-xsappname!b8",
  clientsecret: "0d59bff9-f9d6-4d3b-bc35-4f2f805fd39e$ZH9UWoqffQQ7zwpeaLmDN5dE1shWJbB3gVcBPyhCIqM=",
  url: "https://sgs-apps-dev.authentication.us21.hana.ondemand.com",
  uri: "https://destination-configuration.cfapps.us21.hana.ondemand.com"
};

function request(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Status: ${res.statusCode}, Body: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function getAccessToken() {
  const tokenUrl = `${credentials.url}/oauth/token?grant_type=client_credentials`;
  const parsedUrl = url.parse(tokenUrl);
  const auth = Buffer.from(credentials.clientid + ':' + credentials.clientsecret).toString('base64');
  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.path,
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  };
  const res = await request(options);
  return res.access_token;
}

async function getDestDetails() {
  try {
    const token = await getAccessToken();
    const destUrl = `${credentials.uri}/destination-configuration/v1/subaccountDestinations/ztablemaintenance`;
    const parsedUrl = url.parse(destUrl);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token
      }
    };
    const res = await request(options);
    console.log(JSON.stringify(res, null, 2));
  } catch (error) {
    console.error('Error fetching ztablemaintenance destination:', error.message);
  }
}

getDestDetails();
