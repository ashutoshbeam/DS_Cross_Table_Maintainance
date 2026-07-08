Use one of these destination templates for direct import or manual creation in BTP Destination service.

Files:
- `IAS_SCIM_USERS.destination.properties`
- `IAS_SCIM_USERS.destination.json`

Configured values:
- Base URL: `https://aaj1np4y0.accounts.ondemand.com`
- SCIM users path: `/service/scim/Users`
- Basic auth user: `amith.vandana.incture@beamsuntory.com`

Before importing:
- Replace `CHANGE_ME` with the real password if your IAS tenant accepts basic auth for SCIM.

Important:
- Many IAS/IdP setups do not allow normal end-user password based basic auth for SCIM APIs.
- If this fails with `401` or `403`, use OAuth/token or a technical API user instead.
- The current ZTableMaintenance app does not yet consume this destination automatically; this file is for destination creation/import first.
