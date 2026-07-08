const cds = require("@sap/cds");
const express = require("express");

const ROW_LIMIT = 200;
const FIELD_METADATA_TABLE = "ZSCHEMA_FIELD_METADATA";
const VALUE_HELP_CONFIG_TABLE = "ZSCHEMA_VALUE_HELP_CONFIG";
const VALUE_HELP_ALIAS_TABLE = "ZSCHEMA_VALUE_HELP_ALIAS";
const VALIDATION_RULES_TABLE = "ZSCHEMA_VALIDATION_RULES";
const ROLE_TEMPLATE_DEFINITION_TABLE = "ZSCHEMA_ROLE_TEMPLATE_DEFINITION";
const ROLE_TEMPLATE_TABLE_MAP_TABLE = "ZSCHEMA_ROLE_TEMPLATE_TABLE_MAP";
const USER_ROLE_TEMPLATE_ACCESS_TABLE = "ZSCHEMA_USER_ROLE_TEMPLATE_ACCESS";
const USER_TABLE_ACCESS_TABLE = "ZSCHEMA_USER_TABLE_ACCESS";
const DEFAULT_ROLE_TEMPLATE_DEFINITIONS = [
    { key: "DEMAND", text: "Demand" },
    { key: "SUPPLY", text: "Supply" },
    { key: "BASIC_DATA", text: "Basic Data" }
];
let dbPromise;

const MANAGED_FIELD_NAMES = new Set([
    "ID",
    "createdAt",
    "createdBy",
    "modifiedAt",
    "modifiedBy"
]);

const normalizeColumnName = (name) => String(name || "").toUpperCase();
const normalizeRoleTemplateKey = (value) => String(value || "").trim().toUpperCase();
const normalizeUserEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeAccessTableName = (value) => String(value || "").trim();
const DEFAULT_TEMPLATE_ROLE_ATTRIBUTE_NAMES = [
    "ZTM_TEMPLATE_ROLE",
    "ZTM_TEMPLATE_ROLES",
    "TEMPLATE_ROLE",
    "TEMPLATE_ROLES",
    "ztm_template_role",
    "ztm_template_roles",
    "template_role",
    "template_roles"
];
const DEFAULT_TABLE_ACCESS_ATTRIBUTE_NAMES = [
    "ZTM_TABLE_ACCESS",
    "ZTM_TABLE_ACCESS_LIST",
    "TABLE_ACCESS",
    "TABLE_ACCESS_LIST",
    "ALLOWED_TABLES",
    "ztm_table_access",
    "table_access",
    "allowed_tables"
];

const SYSTEM_TIMESTAMPS = new Set(["CREATEDAT", "MODIFIEDAT"]);
const SYSTEM_USERS = new Set(["CREATEDBY", "MODIFIEDBY"]);

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

const decodeJwtPayload = (token) => {
    if (!token || typeof token !== "string") {
        return null;
    }

    const parts = token.split(".");
    if (parts.length < 2) {
        return null;
    }

    try {
        const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
        return JSON.parse(Buffer.from(normalized + padding, "base64").toString("utf8"));
    } catch (error) {
        return null;
    }
};

const getUserFromJwtPayload = (payload) => {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    return payload.email
        || payload.user_name
        || payload.given_name
        || payload.name
        || payload.sub
        || null;
};

const getAuthTokenFromHeaders = (headers = {}) => {
    const authorization = headers.authorization || headers.Authorization;
    const approuterAuthorization = headers["x-approuter-authorization"] || headers["X-Approuter-Authorization"];
    const bearerValue = authorization || approuterAuthorization;

    if (!bearerValue || typeof bearerValue !== "string") {
        return null;
    }

    return bearerValue.replace(/^Bearer\s+/i, "").trim() || null;
};

const toArray = (result) => {
    if (Array.isArray(result)) {
        return result;
    }
    if (result === undefined || result === null) {
        return [];
    }
    return [result];
};

const normalizeValue = (column, value, { allowNull = true } = {}) => {
    if (value === undefined) {
        return undefined;
    }

    if (value === null || value === "") {
        if (/timestamp|date/i.test(column?.type || "") && value === "") {
            return undefined;
        }

        return allowNull && column.nullable ? null : value;
    }

    if (column && /timestamp|date/i.test(column.type || "") && value instanceof Date) {
        return value.toISOString().replace("T", " ").replace("Z", "");
    }

    return value;
};

const isBlankValue = (value) => value === undefined || value === null || value === "";

const isManagedField = (name) => MANAGED_FIELD_NAMES.has(normalizeColumnName(name));

function isConfigTable(tableName) {
    return String(tableName || "").toUpperCase().startsWith("ZSCHEMA_");
}

function formatTableReference(schemaName, tableName) {
    if (String(tableName || "").includes(".")) {
        const parts = tableName.split(".");
        return `${quoteIdentifier(parts[0])}.${quoteIdentifier(parts[1])}`;
    }
    return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

const normalizeSemanticKey = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const getSemanticAliases = (value) => {
    const normalized = normalizeSemanticKey(value);
    return normalized ? [normalized] : [];
};

const getRequestTokenPayload = (req) => {
    const headers = req?.headers || req?.http?.req?.headers || {};
    return decodeJwtPayload(getAuthTokenFromHeaders(headers));
};

const toAttributeNameList = (envValue, fallback) => {
    const rawValues = String(envValue || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    return rawValues.length ? rawValues : fallback;
};

const flattenAttributeValues = (value) => {
    if (Array.isArray(value)) {
        return value.flatMap(flattenAttributeValues);
    }
    if (value === undefined || value === null) {
        return [];
    }
    if (typeof value === "string") {
        return value
            .split(/[,\n;]+/)
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    return [String(value).trim()].filter(Boolean);
};

const expandTableAttributeValues = (values) => {
    const expanded = new Set();

    (values || []).forEach((value) => {
        const normalized = normalizeAccessTableName(value);
        if (!normalized) {
            return;
        }

        expanded.add(normalized);
        if (normalized.includes(".")) {
            expanded.add(normalized.split(".").pop());
        }
    });

    return Array.from(expanded);
};

const getTokenAttributeBag = (payload) => {
    if (!payload || typeof payload !== "object") {
        return {};
    }

    return payload["xs.user.attributes"]
        || payload?.xs?.user?.attributes
        || payload?.user_attributes
        || payload?.attributes
        || payload?.az_attr
        || {};
};

const getRequestAttributeValues = (req, attributeNames) => {
    const payload = getRequestTokenPayload(req);
    const attributeBag = getTokenAttributeBag(payload);
    const values = [];

    attributeNames.forEach((attributeName) => {
        if (Object.prototype.hasOwnProperty.call(attributeBag, attributeName)) {
            values.push(...flattenAttributeValues(attributeBag[attributeName]));
        }
    });

    return Array.from(new Set(values));
};

const getFieldMetadataPayload = (field = {}) => {
    const semanticType = String(field.semanticType || "").trim();
    const referenceTable = String(field.referenceTable || "").trim();
    const referenceColumn = String(field.referenceColumn || "").trim();
    const valueHelpRequired = field.valueHelpRequired === true
        || field.valueHelpRequired === "true"
        || (!!referenceTable && !!referenceColumn);

    return {
        semanticType,
        referenceTable,
        referenceColumn,
        valueHelpRequired,
        isPrimary: field.isPrimary === true || field.isPrimary === "true"
    };
};

const hasFieldMetadataPayload = (field = {}) => {
    const metadata = getFieldMetadataPayload(field);
    return metadata.valueHelpRequired
        || !!metadata.semanticType
        || !!metadata.referenceTable
        || !!metadata.referenceColumn
        || metadata.isPrimary;
};

const getColumnByName = (definition, name) => {
    const normalized = normalizeColumnName(name);
    return (definition.columns || []).find((column) => normalizeColumnName(column.name) === normalized);
};

const buildWhereClause = (keys, keyColumns, columns) => {
    const columnMap = new Map(columns.map((column) => [column.name, column]));
    const conditions = [];
    const values = [];

    keyColumns.forEach((keyName) => {
        const column = columnMap.get(keyName);
        const value = keys[keyName];

        if (value === undefined || value === "") {
            throw new Error(`Missing key field ${keyName}`);
        }

        conditions.push(`${quoteIdentifier(keyName)} = ?`);
        values.push(normalizeValue(column || { nullable: false }, value, { allowNull: false }));
    });

    if (!conditions.length) {
        throw new Error("No primary key metadata found for the selected table.");
    }

    return {
        clause: conditions.join(" AND "),
        values
    };
};

const getBusinessKeyColumns = (definition) => {
    const nonManagedKeys = (definition.keyColumns || []).filter((keyName) => !isManagedField(keyName));
    return nonManagedKeys.length ? nonManagedKeys : (definition.keyColumns || []);
};

async function validateBusinessKeyUniqueness(db, definition, row, currentKeys) {
    const businessKeyColumns = getBusinessKeyColumns(definition);

    if (!businessKeyColumns.length) {
        return;
    }

    const businessKeyValues = {};
    businessKeyColumns.forEach((keyName) => {
        businessKeyValues[keyName] = row[keyName];
    });

    if (businessKeyColumns.some((keyName) => isBlankValue(businessKeyValues[keyName]))) {
        return;
    }

    const where = buildWhereClause(businessKeyValues, businessKeyColumns, definition.columns);
    let sql = `SELECT * FROM ${quoteIdentifier(definition.schemaName)}.${quoteIdentifier(definition.tableName)}
        WHERE ${where.clause}`;
    let values = where.values.slice();

    if (currentKeys && definition.keyColumns && definition.keyColumns.length) {
        const currentKeyWhere = buildWhereClause(currentKeys, definition.keyColumns, definition.columns);
        sql += ` AND NOT (${currentKeyWhere.clause})`;
        values = values.concat(currentKeyWhere.values);
    }

    sql += " LIMIT 1";

    const [existingRow] = await executeQuery(db, sql, values);

    if (existingRow) {
        const keyLabel = businessKeyColumns.map((keyName) => `${keyName}=${formatAuditValue(row[keyName])}`).join(", ");
        throw new Error(`A record already exists for primary key values ${keyLabel}. Please adjust the key fields and try again.`);
    }
}

async function getDb() {
    if (cds.db) {
        return cds.db;
    }

    dbPromise ??= cds.connect.to("db");
    return dbPromise;
}

async function withDbClient(executor) {
    const db = await getDb();
    return executor(db);
}

async function executeQuery(db, sql, values) {
    const rows = values && values.length ? await db.run(sql, values) : await db.run(sql);
    return toArray(rows);
}

async function executeStatement(db, sql, values) {
    if (values && values.length) {
        await db.run(sql, values);
        return;
    }

    await db.run(sql);
}

async function getCurrentSchema(db) {
    const [row] = await executeQuery(db, `SELECT CURRENT_SCHEMA AS "SCHEMA_NAME" FROM DUMMY`);
    return row && row.SCHEMA_NAME;
}

async function ensureFieldMetadataTable(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT TABLE_NAME
           FROM SYS.TABLES
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, FIELD_METADATA_TABLE]
    );

    if (rows.length) {
        const primaryKeyColumn = await executeQuery(
            db,
            `SELECT COLUMN_NAME
               FROM SYS.TABLE_COLUMNS
              WHERE SCHEMA_NAME = ?
                AND TABLE_NAME = ?
                AND COLUMN_NAME = 'IS_PRIMARY_KEY'`,
            [schemaName, FIELD_METADATA_TABLE]
        );

        if (!primaryKeyColumn.length) {
            await executeStatement(
                db,
                `CALL "EXECUTE_DDL"(?)`,
                [`ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(FIELD_METADATA_TABLE)} ADD ("IS_PRIMARY_KEY" BOOLEAN DEFAULT FALSE NOT NULL)`]
            );
        }
        return;
    }

    const sql = `CREATE COLUMN TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(FIELD_METADATA_TABLE)} (
        "SCHEMA_NAME" NVARCHAR(256) NOT NULL,
        "TABLE_NAME" NVARCHAR(256) NOT NULL,
        "COLUMN_NAME" NVARCHAR(256) NOT NULL,
        "SEMANTIC_TYPE" NVARCHAR(100),
        "REFERENCE_TABLE" NVARCHAR(256),
        "REFERENCE_COLUMN" NVARCHAR(256),
        "VALUE_HELP_REQUIRED" BOOLEAN DEFAULT TRUE NOT NULL,
        "IS_PRIMARY_KEY" BOOLEAN DEFAULT FALSE NOT NULL,
        "UPDATED_AT" TIMESTAMP,
        PRIMARY KEY ("SCHEMA_NAME", "TABLE_NAME", "COLUMN_NAME")
    )`;

    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
}

async function ensureValidationRulesTable(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT TABLE_NAME
           FROM SYS.TABLES
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, VALIDATION_RULES_TABLE]
    );

    if (rows.length) {
        return;
    }

    const sql = `CREATE COLUMN TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALIDATION_RULES_TABLE)} (
        "SCHEMA_NAME" NVARCHAR(256) NOT NULL,
        "TABLE_NAME" NVARCHAR(256) NOT NULL,
        "COLUMN_NAME" NVARCHAR(256) NOT NULL,
        "RULE_TYPE" NVARCHAR(50) NOT NULL,
        "RULE_VALUE" NVARCHAR(500),
        "ERROR_MESSAGE" NVARCHAR(500),
        "UPDATED_AT" TIMESTAMP,
        PRIMARY KEY ("SCHEMA_NAME", "TABLE_NAME", "COLUMN_NAME", "RULE_TYPE")
    )`;

    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
}

async function validateCustomRules(db, schemaName, tableName, row) {
    await ensureValidationRulesTable(db, schemaName);
    const rules = await executeQuery(db,
        `SELECT COLUMN_NAME, RULE_TYPE, RULE_VALUE, ERROR_MESSAGE
           FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALIDATION_RULES_TABLE)}
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, tableName]
    );

    for (const rule of rules) {
        const columnName = rule.COLUMN_NAME;
        const rowKey = Object.keys(row).find((k) => normalizeColumnName(k) === normalizeColumnName(columnName)) || columnName;
        const val = row[rowKey];

        if (isBlankValue(val)) {
            if (rule.RULE_TYPE === "MANDATORY") {
                throw new Error(rule.ERROR_MESSAGE || `${columnName} is mandatory.`);
            }
            continue;
        }

        const sVal = String(val);

        if (rule.RULE_TYPE === "REGEX") {
            const regex = new RegExp(rule.RULE_VALUE);
            if (!regex.test(sVal)) {
                throw new Error(rule.ERROR_MESSAGE || `${columnName} does not match validation pattern.`);
            }
        } else if (rule.RULE_TYPE === "RANGE") {
            const parts = String(rule.RULE_VALUE).split(",");
            const num = Number(val);
            if (isNaN(num)) {
                throw new Error(`${columnName} must be a number for range validation.`);
            }
            const min = parts[0] !== "" ? Number(parts[0]) : -Infinity;
            const max = parts[1] !== "" ? Number(parts[1]) : Infinity;
            if (num < min || num > max) {
                throw new Error(rule.ERROR_MESSAGE || `${columnName} must be between ${parts[0]} and ${parts[1]}.`);
            }
        } else if (rule.RULE_TYPE === "VALUE_LIST") {
            const allowed = String(rule.RULE_VALUE).split(",").map(v => v.trim().toLowerCase());
            if (!allowed.includes(sVal.toLowerCase())) {
                throw new Error(rule.ERROR_MESSAGE || `${columnName} must be one of: ${rule.RULE_VALUE}.`);
            }
        }
    }
}

async function ensureValueHelpConfigTable(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT TABLE_NAME
           FROM SYS.TABLES
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, VALUE_HELP_CONFIG_TABLE]
    );

    if (rows.length) {
        return;
    }

    const sql = `CREATE COLUMN TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALUE_HELP_CONFIG_TABLE)} (
        "SCHEMA_NAME" NVARCHAR(256) NOT NULL,
        "SEMANTIC_TYPE" NVARCHAR(100) NOT NULL,
        "REFERENCE_TABLE" NVARCHAR(256) NOT NULL,
        "REFERENCE_COLUMN" NVARCHAR(256) NOT NULL,
        "UPDATED_AT" TIMESTAMP,
        PRIMARY KEY ("SCHEMA_NAME", "SEMANTIC_TYPE")
    )`;

    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
}

async function ensureValueHelpAliasTable(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT TABLE_NAME
           FROM SYS.TABLES
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, VALUE_HELP_ALIAS_TABLE]
    );

    if (rows.length) {
        return;
    }

    const sql = `CREATE COLUMN TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALUE_HELP_ALIAS_TABLE)} (
        "SCHEMA_NAME" NVARCHAR(256) NOT NULL,
        "SEMANTIC_TYPE" NVARCHAR(100) NOT NULL,
        "ALIAS_NAME" NVARCHAR(256) NOT NULL,
        "UPDATED_AT" TIMESTAMP,
        PRIMARY KEY ("SCHEMA_NAME", "SEMANTIC_TYPE", "ALIAS_NAME")
    )`;

    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
}

async function ensureRoleTemplateDefinitionTable(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT OBJECT_NAME, OBJECT_TYPE
           FROM SYS.OBJECTS
          WHERE SCHEMA_NAME = ?
            AND OBJECT_NAME = ?`,
        [schemaName, ROLE_TEMPLATE_DEFINITION_TABLE]
    );

    if (!rows.length) {
        const sql = `CREATE COLUMN TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(ROLE_TEMPLATE_DEFINITION_TABLE)} (
            "SCHEMA_NAME" NVARCHAR(256) NOT NULL,
            "TEMPLATE_ROLE" NVARCHAR(100) NOT NULL,
            "DISPLAY_TEXT" NVARCHAR(255) NOT NULL,
            "UPDATED_AT" TIMESTAMP,
            PRIMARY KEY ("SCHEMA_NAME", "TEMPLATE_ROLE")
        )`;

        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
    }

    for (const entry of DEFAULT_ROLE_TEMPLATE_DEFINITIONS) {
        await executeStatement(
            db,
            `MERGE INTO ${quoteIdentifier(schemaName)}.${quoteIdentifier(ROLE_TEMPLATE_DEFINITION_TABLE)} AS TARGET
             USING (SELECT ? AS "SCHEMA_NAME", ? AS "TEMPLATE_ROLE", ? AS "DISPLAY_TEXT" FROM DUMMY) AS SOURCE
                ON TARGET."SCHEMA_NAME" = SOURCE."SCHEMA_NAME"
               AND TARGET."TEMPLATE_ROLE" = SOURCE."TEMPLATE_ROLE"
             WHEN NOT MATCHED THEN
               INSERT ("SCHEMA_NAME", "TEMPLATE_ROLE", "DISPLAY_TEXT", "UPDATED_AT")
               VALUES (SOURCE."SCHEMA_NAME", SOURCE."TEMPLATE_ROLE", SOURCE."DISPLAY_TEXT", CURRENT_UTCTIMESTAMP)`,
            [schemaName, entry.key, entry.text]
        );
    }
}

async function getRoleTemplateDefinitions(db, schemaName) {
    await ensureRoleTemplateDefinitionTable(db, schemaName);
    const rows = await executeQuery(
        db,
        `SELECT TEMPLATE_ROLE, DISPLAY_TEXT
           FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(ROLE_TEMPLATE_DEFINITION_TABLE)}
          WHERE SCHEMA_NAME = ?
          ORDER BY TEMPLATE_ROLE`,
        [schemaName]
    );

    return rows.map((row) => ({
        key: normalizeRoleTemplateKey(row.TEMPLATE_ROLE),
        text: String(row.DISPLAY_TEXT || row.TEMPLATE_ROLE || "").trim() || normalizeRoleTemplateKey(row.TEMPLATE_ROLE)
    })).filter((entry) => entry.key);
}

function getRoleTemplateLabel(templateRole, definitions) {
    const normalized = normalizeRoleTemplateKey(templateRole);
    const match = (definitions || []).find((entry) => entry.key === normalized);
    return match ? match.text : normalized;
}

async function ensureRoleTemplateTableMapTable(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT OBJECT_NAME, OBJECT_TYPE
           FROM SYS.OBJECTS
          WHERE SCHEMA_NAME = ?
            AND OBJECT_NAME = ?`,
        [schemaName, ROLE_TEMPLATE_TABLE_MAP_TABLE]
    );

    if (rows.length) {
        return;
    }

    const sql = `CREATE COLUMN TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(ROLE_TEMPLATE_TABLE_MAP_TABLE)} (
        "SCHEMA_NAME" NVARCHAR(256) NOT NULL,
        "TEMPLATE_ROLE" NVARCHAR(100) NOT NULL,
        "TABLE_NAME" NVARCHAR(256) NOT NULL,
        "UPDATED_AT" TIMESTAMP,
        PRIMARY KEY ("SCHEMA_NAME", "TEMPLATE_ROLE", "TABLE_NAME")
    )`;

    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
}

async function ensureUserRoleTemplateAccessTable(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT OBJECT_NAME, OBJECT_TYPE
           FROM SYS.OBJECTS
          WHERE SCHEMA_NAME = ?
            AND OBJECT_NAME = ?`,
        [schemaName, USER_ROLE_TEMPLATE_ACCESS_TABLE]
    );

    if (rows.length) {
        return;
    }

    const sql = `CREATE COLUMN TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(USER_ROLE_TEMPLATE_ACCESS_TABLE)} (
        "SCHEMA_NAME" NVARCHAR(256) NOT NULL,
        "USER_EMAIL" NVARCHAR(320) NOT NULL,
        "TEMPLATE_ROLE" NVARCHAR(100) NOT NULL,
        "UPDATED_AT" TIMESTAMP,
        PRIMARY KEY ("SCHEMA_NAME", "USER_EMAIL", "TEMPLATE_ROLE")
    )`;

    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
}

async function ensureUserTableAccessTable(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT OBJECT_NAME, OBJECT_TYPE
           FROM SYS.OBJECTS
          WHERE SCHEMA_NAME = ?
            AND OBJECT_NAME = ?`,
        [schemaName, USER_TABLE_ACCESS_TABLE]
    );

    if (rows.length) {
        return;
    }

    const sql = `CREATE COLUMN TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(USER_TABLE_ACCESS_TABLE)} (
        "SCHEMA_NAME" NVARCHAR(256) NOT NULL,
        "USER_EMAIL" NVARCHAR(320) NOT NULL,
        "TABLE_NAME" NVARCHAR(256) NOT NULL,
        "UPDATED_AT" TIMESTAMP,
        PRIMARY KEY ("SCHEMA_NAME", "USER_EMAIL", "TABLE_NAME")
    )`;

    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
}

async function ensureAccessConfigTables(db, schemaName) {
    await ensureRoleTemplateDefinitionTable(db, schemaName);
    await ensureRoleTemplateTableMapTable(db, schemaName);
    await ensureUserRoleTemplateAccessTable(db, schemaName);
    await ensureUserTableAccessTable(db, schemaName);
}

async function getRoleTemplateTableMappings(db, schemaName) {
    await ensureRoleTemplateTableMapTable(db, schemaName);
    const rows = await executeQuery(
        db,
        `SELECT TEMPLATE_ROLE, TABLE_NAME
           FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(ROLE_TEMPLATE_TABLE_MAP_TABLE)}
          WHERE SCHEMA_NAME = ?
          ORDER BY TEMPLATE_ROLE, TABLE_NAME`,
        [schemaName]
    );

    return rows.map((row) => ({
        templateRole: normalizeRoleTemplateKey(row.TEMPLATE_ROLE),
        tableName: String(row.TABLE_NAME || "")
    }));
}

async function getUserRoleTemplateAssignments(db, schemaName, userEmail) {
    await ensureUserRoleTemplateAccessTable(db, schemaName);
    const normalizedUser = normalizeUserEmail(userEmail);
    if (!normalizedUser) {
        return [];
    }

    const rows = await executeQuery(
        db,
        `SELECT TEMPLATE_ROLE
           FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(USER_ROLE_TEMPLATE_ACCESS_TABLE)}
          WHERE SCHEMA_NAME = ?
            AND LOWER(USER_EMAIL) = ?
          ORDER BY TEMPLATE_ROLE`,
        [schemaName, normalizedUser]
    );

    return rows.map((row) => normalizeRoleTemplateKey(row.TEMPLATE_ROLE)).filter(Boolean);
}

async function getUserTableAssignments(db, schemaName, userEmail) {
    await ensureUserTableAccessTable(db, schemaName);
    const normalizedUser = normalizeUserEmail(userEmail);
    if (!normalizedUser) {
        return [];
    }

    const rows = await executeQuery(
        db,
        `SELECT TABLE_NAME
           FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(USER_TABLE_ACCESS_TABLE)}
          WHERE SCHEMA_NAME = ?
            AND LOWER(USER_EMAIL) = ?
          ORDER BY TABLE_NAME`,
        [schemaName, normalizedUser]
    );

    return rows.map((row) => String(row.TABLE_NAME || "")).filter(Boolean);
}

async function upsertRoleTemplateTableMapping(db, schemaName, templateRole, tableName) {
    const normalizedRole = normalizeRoleTemplateKey(templateRole);
    const normalizedTable = String(tableName || "").trim();

    if (!normalizedRole || !normalizedTable) {
        return;
    }

    await ensureRoleTemplateTableMapTable(db, schemaName);
    await executeStatement(
        db,
        `UPSERT ${quoteIdentifier(schemaName)}.${quoteIdentifier(ROLE_TEMPLATE_TABLE_MAP_TABLE)}
            ("SCHEMA_NAME", "TEMPLATE_ROLE", "TABLE_NAME", "UPDATED_AT")
         VALUES (?, ?, ?, CURRENT_UTCTIMESTAMP)
         WITH PRIMARY KEY`,
        [schemaName, normalizedRole, normalizedTable]
    );
}

async function deleteRoleTemplateTableMappings(db, schemaName, tableName) {
    await ensureRoleTemplateTableMapTable(db, schemaName);
    await executeStatement(
        db,
        `DELETE FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(ROLE_TEMPLATE_TABLE_MAP_TABLE)}
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, tableName]
    );
}

async function deleteUserTableAssignments(db, schemaName, tableName) {
    await ensureUserTableAccessTable(db, schemaName);
    await executeStatement(
        db,
        `DELETE FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(USER_TABLE_ACCESS_TABLE)}
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, tableName]
    );
}

function buildRoleTemplateTableLookup(mappings) {
    const lookup = new Map();
    (mappings || []).forEach((mapping) => {
        const tableName = String(mapping.tableName || "");
        if (!tableName) {
            return;
        }
        if (!lookup.has(tableName)) {
            lookup.set(tableName, []);
        }
        const roles = lookup.get(tableName);
        if (!roles.includes(mapping.templateRole)) {
            roles.push(mapping.templateRole);
        }
    });
    return lookup;
}

function buildTemplateRoleLookup(mappings) {
    const lookup = new Map();
    (mappings || []).forEach((mapping) => {
        if (!lookup.has(mapping.templateRole)) {
            lookup.set(mapping.templateRole, []);
        }
        const tables = lookup.get(mapping.templateRole);
        if (!tables.includes(mapping.tableName)) {
            tables.push(mapping.tableName);
        }
    });
    return lookup;
}

async function getFieldMetadataMap(db, schemaName, tableName) {
    await ensureFieldMetadataTable(db, schemaName);

    const rows = await executeQuery(db,
        `SELECT COLUMN_NAME,
                SEMANTIC_TYPE,
                REFERENCE_TABLE,
                REFERENCE_COLUMN,
                VALUE_HELP_REQUIRED,
                IS_PRIMARY_KEY
           FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(FIELD_METADATA_TABLE)}
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, tableName]
    );

    return rows.reduce((map, row) => {
        map.set(row.COLUMN_NAME, {
            semanticType: row.SEMANTIC_TYPE || "",
            referenceTable: row.REFERENCE_TABLE || "",
            referenceColumn: row.REFERENCE_COLUMN || "",
            valueHelpRequired: row.VALUE_HELP_REQUIRED === true || row.VALUE_HELP_REQUIRED === "TRUE" || row.VALUE_HELP_REQUIRED === 1,
            isPrimary: row.IS_PRIMARY_KEY === true || row.IS_PRIMARY_KEY === "TRUE" || row.IS_PRIMARY_KEY === 1
        });
        return map;
    }, new Map());
}

async function getSchemaValueHelpMap(db, schemaName) {
    await ensureValueHelpConfigTable(db, schemaName);

    const rows = await executeQuery(db,
        `SELECT SEMANTIC_TYPE,
                REFERENCE_TABLE,
                REFERENCE_COLUMN
           FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALUE_HELP_CONFIG_TABLE)}
          WHERE SCHEMA_NAME = ?`,
        [schemaName]
    );

    return rows.reduce((map, row) => {
        map.set(normalizeSemanticKey(row.SEMANTIC_TYPE), {
            semanticType: row.SEMANTIC_TYPE || "",
            referenceTable: row.REFERENCE_TABLE || "",
            referenceColumn: row.REFERENCE_COLUMN || "",
            valueHelpRequired: true
        });
        return map;
    }, new Map());
}

async function getSchemaValueHelpAliases(db, schemaName) {
    await ensureValueHelpAliasTable(db, schemaName);

    const rows = await executeQuery(db,
        `SELECT SEMANTIC_TYPE,
                ALIAS_NAME
           FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALUE_HELP_ALIAS_TABLE)}
          WHERE SCHEMA_NAME = ?`,
        [schemaName]
    );

    return rows.reduce((map, row) => {
        const semanticKey = normalizeSemanticKey(row.SEMANTIC_TYPE);
        const aliasKey = normalizeSemanticKey(row.ALIAS_NAME);

        if (!semanticKey || !aliasKey) {
            return map;
        }

        if (!map.has(semanticKey)) {
            map.set(semanticKey, new Set());
        }

        map.get(semanticKey).add(aliasKey);
        return map;
    }, new Map());
}

async function getSchemaValueHelpConfigBySemanticType(db, schemaName, semanticType) {
    const semanticKey = normalizeSemanticKey(semanticType);

    if (!semanticKey) {
        return null;
    }

    const configMap = await getSchemaValueHelpMap(db, schemaName);
    const aliasMap = await getSchemaValueHelpAliases(db, schemaName);
    const aliases = Array.from(aliasMap.get(semanticKey) || []);
    const config = configMap.get(semanticKey);

    if (!config) {
        return null;
    }

    return {
        semanticType: config.semanticType || semanticType,
        referenceTable: config.referenceTable || "",
        referenceColumn: config.referenceColumn || "",
        aliases: aliases.join(", ")
    };
}

async function replaceFieldMetadata(db, schemaName, tableName, fields) {
    await ensureFieldMetadataTable(db, schemaName);

    await executeStatement(
        db,
        `DELETE FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(FIELD_METADATA_TABLE)}
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, tableName]
    );

    for (const field of fields || []) {
        const metadata = getFieldMetadataPayload(field);

        if (!hasFieldMetadataPayload(metadata)) {
            continue;
        }

        await executeStatement(
            db,
            `INSERT INTO ${quoteIdentifier(schemaName)}.${quoteIdentifier(FIELD_METADATA_TABLE)}
                ("SCHEMA_NAME", "TABLE_NAME", "COLUMN_NAME", "SEMANTIC_TYPE", "REFERENCE_TABLE", "REFERENCE_COLUMN", "VALUE_HELP_REQUIRED", "IS_PRIMARY_KEY", "UPDATED_AT")
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_UTCTIMESTAMP)`,
            [
                schemaName,
                tableName,
                field.name,
                metadata.semanticType || null,
                metadata.referenceTable || null,
                metadata.referenceColumn || null,
                metadata.valueHelpRequired,
                metadata.isPrimary
            ]
        );
    }
}

async function upsertSchemaValueHelpConfig(db, schemaName, fields) {
    await ensureValueHelpConfigTable(db, schemaName);

    for (const field of fields || []) {
        const metadata = getFieldMetadataPayload(field);
        const semanticKey = normalizeSemanticKey(metadata.semanticType);

        if (!semanticKey || !metadata.referenceTable || !metadata.referenceColumn) {
            continue;
        }

        await executeStatement(
            db,
            `DELETE FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALUE_HELP_CONFIG_TABLE)}
              WHERE SCHEMA_NAME = ?
                AND SEMANTIC_TYPE = ?`,
            [schemaName, semanticKey]
        );

        await executeStatement(
            db,
            `INSERT INTO ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALUE_HELP_CONFIG_TABLE)}
                ("SCHEMA_NAME", "SEMANTIC_TYPE", "REFERENCE_TABLE", "REFERENCE_COLUMN", "UPDATED_AT")
             VALUES (?, ?, ?, ?, CURRENT_UTCTIMESTAMP)`,
            [
                schemaName,
                semanticKey,
                metadata.referenceTable,
                metadata.referenceColumn
            ]
        );
    }
}

async function upsertSchemaValueHelpAliases(db, schemaName, fields) {
    await ensureValueHelpAliasTable(db, schemaName);

    for (const field of fields || []) {
        const metadata = getFieldMetadataPayload(field);
        const semanticKey = normalizeSemanticKey(metadata.semanticType);
        const aliasCandidates = new Set([
            normalizeSemanticKey(field.name),
            normalizeSemanticKey(metadata.referenceColumn),
            ...String(field.aliases || "")
                .split(",")
                .map((entry) => normalizeSemanticKey(entry))
                .filter(Boolean)
        ]);

        if (!semanticKey) {
            continue;
        }

        for (const aliasKey of aliasCandidates) {
            if (!aliasKey) {
                continue;
            }

            const existing = await executeQuery(
                db,
                `SELECT ALIAS_NAME
                   FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALUE_HELP_ALIAS_TABLE)}
                  WHERE SCHEMA_NAME = ?
                    AND SEMANTIC_TYPE = ?
                    AND ALIAS_NAME = ?`,
                [schemaName, semanticKey, aliasKey]
            );

            if (existing.length) {
                continue;
            }

            await executeStatement(
                db,
                `INSERT INTO ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALUE_HELP_ALIAS_TABLE)}
                    ("SCHEMA_NAME", "SEMANTIC_TYPE", "ALIAS_NAME", "UPDATED_AT")
                 VALUES (?, ?, ?, CURRENT_UTCTIMESTAMP)`,
                [schemaName, semanticKey, aliasKey]
            );
        }
    }
}

async function deleteFieldMetadata(db, schemaName, tableName) {
    await ensureFieldMetadataTable(db, schemaName);

    await executeStatement(
        db,
        `DELETE FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(FIELD_METADATA_TABLE)}
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?`,
        [schemaName, tableName]
    );
}

async function getTables(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT TABLE_NAME
           FROM SYS.TABLES
          WHERE SCHEMA_NAME = ?
         UNION ALL
         SELECT VIEW_NAME AS TABLE_NAME
           FROM SYS.VIEWS
          WHERE SCHEMA_NAME = ?
          ORDER BY TABLE_NAME`,
        [schemaName, schemaName]
    );

    return rows.map((row) => ({
        name: row.TABLE_NAME,
        label: row.TABLE_NAME
    }));
}

async function getColumns(db, schemaName, tableName) {
    let querySchema = schemaName;
    let queryTable = tableName;
    if (String(tableName || "").includes(".")) {
        const parts = tableName.split(".");
        querySchema = parts[0];
        queryTable = parts[1];
    }
    const rows = await executeQuery(db,
        `SELECT COLUMN_NAME,
                DATA_TYPE_NAME,
                LENGTH,
                SCALE,
                IS_NULLABLE,
                POSITION
           FROM SYS.TABLE_COLUMNS
          WHERE SCHEMA_NAME = ?
            AND TABLE_NAME = ?
         UNION ALL
         SELECT COLUMN_NAME,
                DATA_TYPE_NAME,
                LENGTH,
                SCALE,
                IS_NULLABLE,
                POSITION
           FROM SYS.VIEW_COLUMNS
          WHERE SCHEMA_NAME = ?
            AND VIEW_NAME = ?
          ORDER BY POSITION`,
        [querySchema, queryTable, querySchema, queryTable]
    );

    return rows.map((row) => ({
        name: row.COLUMN_NAME,
        type: row.DATA_TYPE_NAME,
        length: row.LENGTH,
        scale: row.SCALE,
        nullable: row.IS_NULLABLE === "TRUE"
    }));
}

async function getPrimaryKeys(db, schemaName, tableName, columns) {
    const upperTable = String(tableName || "").toUpperCase();
    if (upperTable === "ZSCHEMA_FIELD_METADATA") {
        return ["SCHEMA_NAME", "TABLE_NAME", "COLUMN_NAME"];
    }
    if (upperTable === "ZSCHEMA_VALUE_HELP_CONFIG") {
        return ["SCHEMA_NAME", "SEMANTIC_TYPE"];
    }
    if (upperTable === "ZSCHEMA_VALUE_HELP_ALIAS") {
        return ["SCHEMA_NAME", "SEMANTIC_TYPE", "ALIAS_NAME"];
    }
    if (upperTable === "ZSCHEMA_VALIDATION_RULES") {
        return ["SCHEMA_NAME", "TABLE_NAME", "COLUMN_NAME", "RULE_TYPE"];
    }
    if (upperTable === "ZSCHEMA_ROLE_TEMPLATE_DEFINITION") {
        return ["SCHEMA_NAME", "TEMPLATE_ROLE"];
    }
    if (upperTable === "ZSCHEMA_ROLE_TEMPLATE_TABLE_MAP") {
        return ["SCHEMA_NAME", "TEMPLATE_ROLE", "TABLE_NAME"];
    }
    if (upperTable === "ZSCHEMA_USER_ROLE_TEMPLATE_ACCESS") {
        return ["SCHEMA_NAME", "USER_EMAIL", "TEMPLATE_ROLE"];
    }
    if (upperTable === "ZSCHEMA_USER_TABLE_ACCESS") {
        return ["SCHEMA_NAME", "USER_EMAIL", "TABLE_NAME"];
    }

    try {
        const rows = await executeQuery(db,
            `SELECT CC.COLUMN_NAME
               FROM SYS.CONSTRAINTS C
               JOIN SYS.CONSTRAINT_COLUMNS CC
                 ON C.SCHEMA_NAME = CC.SCHEMA_NAME
                AND C.TABLE_NAME = CC.TABLE_NAME
                AND C.CONSTRAINT_NAME = CC.CONSTRAINT_NAME
              WHERE C.SCHEMA_NAME = ?
                AND C.TABLE_NAME = ?
                AND C.CONSTRAINT_TYPE = 'PRIMARY KEY'
              ORDER BY CC.POSITION`,
            [schemaName, tableName]
        );

        if (rows.length) {
            return rows.map((row) => row.COLUMN_NAME);
        }
    } catch (error) {
        // Fall back to the first column when the catalog view is unavailable.
    }

    try {
        const fieldMetadata = await getFieldMetadataMap(db, schemaName, tableName);
        const metadataKeys = columns
            .map((column) => column.name)
            .filter((columnName) => fieldMetadata.get(columnName)?.isPrimary);

        if (metadataKeys.length) {
            return metadataKeys;
        }
    } catch (error) {
        // Continue to last-resort fallback.
    }

    return columns.length ? [columns[0].name] : [];
}

async function getTableDefinition(db, schemaName, tableName) {
    // Auto-create any ZSCHEMA config table the first time it is accessed.
    if (tableName === VALIDATION_RULES_TABLE) {
        await ensureValidationRulesTable(db, schemaName);
    } else if (tableName === FIELD_METADATA_TABLE) {
        await ensureFieldMetadataTable(db, schemaName);
    } else if (tableName === VALUE_HELP_CONFIG_TABLE) {
        await ensureValueHelpConfigTable(db, schemaName);
    } else if (tableName === VALUE_HELP_ALIAS_TABLE) {
        await ensureValueHelpAliasTable(db, schemaName);
    } else if (tableName === ROLE_TEMPLATE_TABLE_MAP_TABLE) {
        await ensureRoleTemplateTableMapTable(db, schemaName);
    } else if (tableName === USER_ROLE_TEMPLATE_ACCESS_TABLE) {
        await ensureUserRoleTemplateAccessTable(db, schemaName);
    } else if (tableName === USER_TABLE_ACCESS_TABLE) {
        await ensureUserTableAccessTable(db, schemaName);
    }
    const tables = await getTables(db, schemaName);
    const table = tables.find((entry) => entry.name === tableName);

    if (!table) {
        throw new Error(`Table ${tableName} is not available in schema ${schemaName}.`);
    }

    const columns = await getColumns(db, schemaName, tableName);
    const keyColumns = await getPrimaryKeys(db, schemaName, tableName, columns);
    const fieldMetadata = await getFieldMetadataMap(db, schemaName, tableName);
    const schemaValueHelpMap = await getSchemaValueHelpMap(db, schemaName);
    const schemaValueHelpAliases = await getSchemaValueHelpAliases(db, schemaName);

    return {
        schemaName,
        tableName,
        keyColumns,
        columns: columns.map((column) => {
            const isKeyColumn = keyColumns.includes(column.name) || !!fieldMetadata.get(column.name)?.isPrimary;
            return {
                ...column,
                ...resolveColumnValueHelp(column, fieldMetadata.get(column.name), schemaValueHelpMap, schemaValueHelpAliases),
                key: isKeyColumn,
                editable: !isKeyColumn
            };
        })
    };
}

function buildColumnDefinition(field, includeNullability = true) {
    let colDef = `${quoteIdentifier(field.name)} ${field.type}`;
    const typeUpper = String(field.type || "").toUpperCase();

    if (field.length && ["VARCHAR", "NVARCHAR", "VARBINARY", "DECIMAL"].includes(typeUpper)) {
        if (typeUpper === "DECIMAL") {
            colDef += `(${field.length}${field.scale ? "," + field.scale : ""})`;
        } else {
            colDef += `(${field.length})`;
        }
    }

    if (includeNullability && (field.isNotNull || field.isPrimary)) {
        colDef += " NOT NULL";
    }

    return colDef;
}

function normalizePrimaryKeyFields(fields) {
    return (fields || []).map((field) => ({
        ...field,
        isPrimary: !!field.isPrimary,
        isNotNull: !!field.isPrimary || !!field.isNotNull
    }));
}

function haveSamePrimaryKeys(currentKeys, requestedKeys) {
    if (currentKeys.length !== requestedKeys.length) {
        return false;
    }

    return currentKeys.every((key, index) => key === requestedKeys[index]);
}

function isStringDataType(typeName) {
    const typeUpper = String(typeName || "").toUpperCase();
    return ["VARCHAR", "NVARCHAR", "ALPHANUM", "SHORTTEXT", "TEXT"].includes(typeUpper);
}

function isUserFacingValidationError(error) {
    const message = String(error?.message || error || "");
    return message.includes("Primary key change cannot be applied")
        || message.includes("At least one primary key column is required");
}

async function validatePrimaryKeyData(db, schemaName, tableName, primaryKeyFields) {
    if (!primaryKeyFields.length) {
        throw new Error("At least one primary key column is required. Select the key columns and try Alter Table again.");
    }

    const tableRef = `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
    const keyLabel = primaryKeyFields.map((field) => field.name).join(", ");
    const nullChecks = primaryKeyFields.map((field) => {
        const quotedColumn = quoteIdentifier(field.name);
        if (isStringDataType(field.type)) {
            return `(${quotedColumn} IS NULL OR LENGTH(TRIM(${quotedColumn})) = 0)`;
        }
        return `${quotedColumn} IS NULL`;
    });
    const nullResult = await executeQuery(
        db,
        `SELECT COUNT(*) AS VIOLATION_COUNT
           FROM ${tableRef}
          WHERE ${nullChecks.join(" OR ")}`,
        []
    );
    const nullViolations = Number(nullResult?.[0]?.VIOLATION_COUNT || 0);

    if (nullViolations > 0) {
        throw new Error(`Primary key change cannot be applied. Existing rows contain empty or null values for ${keyLabel}. Please clean the table data and try Alter Table again.`);
    }

    const duplicateResult = await executeQuery(
        db,
        `SELECT TOP 1 1 AS HAS_DUPLICATE
           FROM ${tableRef}
          GROUP BY ${primaryKeyFields.map((field) => quoteIdentifier(field.name)).join(", ")}
         HAVING COUNT(*) > 1`,
        []
    );

    if (duplicateResult.length) {
        throw new Error(`Primary key change cannot be applied. Existing rows contain duplicate values for ${keyLabel}. Please clean the table data and try Alter Table again.`);
    }
}

async function applyPrimaryKeyChange(db, schemaName, tableName, currentPrimaryKeys, requestedPrimaryKeys) {
    if (haveSamePrimaryKeys(currentPrimaryKeys, requestedPrimaryKeys)) {
        return;
    }

    const tableRef = `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;

    if (currentPrimaryKeys.length) {
        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [`ALTER TABLE ${tableRef} DROP PRIMARY KEY`]);
    }

    if (requestedPrimaryKeys.length) {
        await executeStatement(
            db,
            `CALL "EXECUTE_DDL"(?)`,
            [`ALTER TABLE ${tableRef} ADD PRIMARY KEY (${requestedPrimaryKeys.map((columnName) => quoteIdentifier(columnName)).join(", ")})`]
        );
    }
}

async function alterTableDefinition(db, schemaName, tableName, fields) {
    const normalizedFields = normalizePrimaryKeyFields(fields);

    await validateFieldMetadataConfiguration(db, schemaName, normalizedFields);

    const currentColsSql = `
        SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE
          FROM SYS.TABLE_COLUMNS
         WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?
         UNION ALL
        SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE
          FROM SYS.VIEW_COLUMNS
         WHERE SCHEMA_NAME = ? AND VIEW_NAME = ?
    `;
    const currentCols = await executeQuery(db, currentColsSql, [schemaName, tableName, schemaName, tableName]);
    const currentColMap = new Map();
    currentCols.forEach((column) => currentColMap.set(column.COLUMN_NAME, column));

    const reqColMap = new Map();
    normalizedFields.forEach((field) => reqColMap.set(field.name, field));

    for (const field of normalizedFields) {
        const colDef = buildColumnDefinition(field);
        const typeUpper = String(field.type || "").toUpperCase();
        const desiredNullable = !(field.isNotNull || field.isPrimary);

        if (!currentColMap.has(field.name)) {
            let addColDef = colDef;
            if (field.defaultValue !== undefined && field.defaultValue !== null && field.defaultValue !== "") {
                addColDef += ` DEFAULT '${String(field.defaultValue).replace(/'/g, "''")}'`;
            }

            const sql = `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ADD (${addColDef})`;
            await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
        } else {
            const currentColumn = currentColMap.get(field.name);
            const currentType = String(currentColumn.DATA_TYPE_NAME || "").toUpperCase();
            const currentNullable = String(currentColumn.IS_NULLABLE || "").toUpperCase() === "TRUE";
            const shouldAlter =
                typeUpper !== currentType
                || field.length != currentColumn.LENGTH
                || field.scale != currentColumn.SCALE
                || currentNullable !== desiredNullable;

            if (shouldAlter) {
                const sql = `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ALTER (${colDef})`;
                await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
            }
        }

        if (field.comment) {
            await executeStatement(
                db,
                `CALL "EXECUTE_DDL"(?)`,
                [`COMMENT ON COLUMN ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}.${quoteIdentifier(field.name)} IS '${String(field.comment).replace(/'/g, "''")}'`]
            );
        }
    }

    const currentPrimaryKeys = await getPrimaryKeys(
        db,
        schemaName,
        tableName,
        currentCols.map((column) => ({ name: column.COLUMN_NAME }))
    );
    const requestedPrimaryKeyFields = normalizedFields.filter((field) => field.isPrimary);
    const requestedPrimaryKeys = requestedPrimaryKeyFields.map((field) => field.name);

    await validatePrimaryKeyData(db, schemaName, tableName, requestedPrimaryKeyFields);
    await applyPrimaryKeyChange(db, schemaName, tableName, currentPrimaryKeys, requestedPrimaryKeys);

    for (const currentColumn of currentCols) {
        if (!reqColMap.has(currentColumn.COLUMN_NAME)) {
            const sql = `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} DROP (${quoteIdentifier(currentColumn.COLUMN_NAME)})`;
            await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
        }
    }

    await replaceFieldMetadata(db, schemaName, tableName, normalizedFields);
    await upsertSchemaValueHelpConfig(db, schemaName, normalizedFields);
    await upsertSchemaValueHelpAliases(db, schemaName, normalizedFields);
}

function resolveColumnValueHelp(column, explicitMetadata, schemaValueHelpMap, schemaValueHelpAliases) {
    const directMetadata = explicitMetadata && explicitMetadata.valueHelpRequired
        ? explicitMetadata
        : null;
    const columnKey = normalizeSemanticKey(column?.name);
    const explicitSemanticKey = normalizeSemanticKey(explicitMetadata?.semanticType);
    const inheritedSemanticKey = explicitSemanticKey
        || Array.from(schemaValueHelpAliases.entries()).find(function ([, aliases]) {
            return aliases.has(columnKey);
        })?.[0]
        || columnKey;
    const semanticCandidates = getSemanticAliases(inheritedSemanticKey);
    const inheritedMetadata = semanticCandidates
        .map((candidate) => schemaValueHelpMap.get(candidate))
        .find(Boolean);
    const resolved = directMetadata || inheritedMetadata || explicitMetadata || {};

    return {
        semanticType: resolved.semanticType || explicitMetadata?.semanticType || inheritedSemanticKey || "",
        referenceTable: resolved.referenceTable || "",
        referenceColumn: resolved.referenceColumn || "",
        valueHelpRequired: !!(resolved.referenceTable && resolved.referenceColumn && (resolved.valueHelpRequired === true || inheritedMetadata))
    };
}

async function validateFieldMetadataConfiguration(db, schemaName, fields) {
    const MANAGED_FIELDS = new Set(["ID", "CREATEDAT", "CREATEDBY", "MODIFIEDAT", "MODIFIEDBY"]);

    for (const field of fields || []) {
        // Skip managed/system fields — they never need value-help references
        if (MANAGED_FIELDS.has(normalizeColumnName(field.name))) {
            continue;
        }

        const metadata = getFieldMetadataPayload(field);

        field.semanticType = metadata.semanticType;
        field.referenceTable = metadata.referenceTable;
        field.referenceColumn = metadata.referenceColumn;
        field.valueHelpRequired = metadata.valueHelpRequired;

        // Only validate reference config when:
        // 1. valueHelpRequired is explicitly set to true, OR
        // 2. A partial reference config exists (one of table/column set but not both)
        // Semantic type alone does NOT require a reference table/column.
        const hasExplicitValueHelp = field.valueHelpRequired === true || field.valueHelpRequired === "true";
        const hasPartialReference = !!(field.referenceTable || field.referenceColumn);
        const needsReferenceValidation = hasExplicitValueHelp || hasPartialReference;

        if (!needsReferenceValidation) {
            continue;
        }

        if (!field.referenceTable || !field.referenceColumn) {
            throw new Error(`Reference table and reference column are required for field ${field.name}.`);
        }

        const referenceColumns = await getColumns(db, schemaName, field.referenceTable);

        if (!referenceColumns.length) {
            throw new Error(`Reference table ${field.referenceTable} was not found in schema ${schemaName}.`);
        }

        if (!referenceColumns.some((column) => normalizeColumnName(column.name) === normalizeColumnName(field.referenceColumn))) {
            throw new Error(`Reference column ${field.referenceColumn} was not found in ${field.referenceTable}.`);
        }
    }
}

async function validateValueHelpValues(db, definition, payload) {
    if (isConfigTable(definition.tableName)) {
        return;
    }
    for (const column of definition.columns || []) {
        if (!column.valueHelpRequired || !column.referenceTable || !column.referenceColumn) {
            continue;
        }

        const isSelfReferentialValueHelp =
            normalizeSemanticKey(column.referenceTable) === normalizeSemanticKey(definition.tableName) &&
            normalizeSemanticKey(column.referenceColumn) === normalizeSemanticKey(column.name);
        if (isSelfReferentialValueHelp) {
            continue;
        }

        const payloadKey = Object.keys(payload).find((key) => normalizeColumnName(key) === normalizeColumnName(column.name));
        if (!payloadKey || isBlankValue(payload[payloadKey])) {
            continue;
        }

        const sVal = payload[payloadKey];
        const rows = await executeQuery(
            db,
            `SELECT ${quoteIdentifier(column.referenceColumn)} AS "VALUE"
               FROM ${formatTableReference(definition.schemaName, column.referenceTable)}
              WHERE ${quoteIdentifier(column.referenceColumn)} = ?
              LIMIT 1`,
            [sVal]
        );

        if (!rows.length) {
            throw new Error(`Value "${sVal}" is not valid for ${column.name}. Use the available value help.`);
        }
    }
}

function findValueHelpDescriptionColumn(referenceColumns, referenceColumn) {
    const normalizedReference = normalizeColumnName(referenceColumn);
    const baseCandidates = [
        `${normalizedReference}_NAME`,
        `${normalizedReference}_DESC`,
        `${normalizedReference}_DESCRIPTION`,
        normalizedReference.replace(/_CODE$/, "_NAME"),
        normalizedReference.replace(/_ID$/, "_NAME"),
        "NAME",
        "DESCR",
        "DESCRIPTION"
    ];

    return referenceColumns.find((column) => baseCandidates.includes(normalizeColumnName(column.name))) || null;
}

async function readRows(db, definition, search) {
    const qualifiedName = `${quoteIdentifier(definition.schemaName)}.${quoteIdentifier(definition.tableName)}`;
    const searchableColumns = definition.columns.map((column) => column.name);
    const params = [];
    let whereClause = "";

    if (search) {
        whereClause = ` WHERE ${searchableColumns
            .map((name) => `LOWER(TO_NVARCHAR(${quoteIdentifier(name)})) LIKE ?`)
            .join(" OR ")}`;
        searchableColumns.forEach(() => params.push(`%${search.toLowerCase()}%`));
    }

    const orderBy = definition.keyColumns.length
        ? ` ORDER BY ${definition.keyColumns.map((name) => quoteIdentifier(name)).join(", ")}`
        : "";

    const rows = await executeQuery(db,
        `SELECT * FROM ${qualifiedName}${whereClause}${orderBy} LIMIT ${ROW_LIMIT}`,
        params
    );

    const [countRow] = await executeQuery(db,
        `SELECT COUNT(*) AS "COUNT" FROM ${qualifiedName}${whereClause}`,
        params
    );

    return {
        count: countRow ? Number(countRow.COUNT) : rows.length,
        rows
    };
}

async function insertRow(db, definition, payload, req) {
    const now = new Date();
    const user = getRequestUser(req);
    const row = Object.assign({}, payload);

    const idColumn = getColumnByName(definition, "ID");
    const createdAtColumn = getColumnByName(definition, "createdAt");
    const createdByColumn = getColumnByName(definition, "createdBy");
    const modifiedAtColumn = getColumnByName(definition, "modifiedAt");
    const modifiedByColumn = getColumnByName(definition, "modifiedBy");
    const updatedAtColumn = getColumnByName(definition, "UPDATED_AT") || getColumnByName(definition, "updatedAt");

    if (idColumn && isBlankValue(row[idColumn.name])) {
        row[idColumn.name] = cds.utils.uuid();
    }

    if (createdAtColumn && isBlankValue(row[createdAtColumn.name])) {
        row[createdAtColumn.name] = now;
    }

    if (createdByColumn && isBlankValue(row[createdByColumn.name])) {
        row[createdByColumn.name] = user;
    }

    if (modifiedAtColumn && isBlankValue(row[modifiedAtColumn.name])) {
        row[modifiedAtColumn.name] = now;
    }

    if (modifiedByColumn && isBlankValue(row[modifiedByColumn.name])) {
        row[modifiedByColumn.name] = user;
    }

    if (updatedAtColumn && isBlankValue(row[updatedAtColumn.name])) {
        row[updatedAtColumn.name] = now;
    }

    await validateBusinessKeyUniqueness(db, definition, row);
    await validateValueHelpValues(db, definition, row);
    await validateCustomRules(db, definition.schemaName, definition.tableName, row);

    const validColumns = definition.columns
        .filter((column) => row[column.name] !== undefined)
        .map((column) => ({
            ...column,
            value: normalizeValue(column, row[column.name])
        }))
        .filter((column) => column.value !== undefined);

    if (!validColumns.length) {
        throw new Error("No values provided to create a row.");
    }

    const sql = `INSERT INTO ${quoteIdentifier(definition.schemaName)}.${quoteIdentifier(definition.tableName)}
        (${validColumns.map((column) => quoteIdentifier(column.name)).join(", ")})
        VALUES (${validColumns.map(() => "?").join(", ")})`;

    await executeStatement(db, sql, validColumns.map((column) => column.value));
    await writeChangeLog(db, definition, "create", row, null, row, req);
}

async function updateRow(db, definition, keys, changes, req) {
    const beforeRow = await readRowByKeys(db, definition, keys);
    const now = new Date();
    const user = getRequestUser(req);
    const payload = Object.assign({}, changes);
    const idColumn = getColumnByName(definition, "ID");
    const modifiedAtColumn = getColumnByName(definition, "modifiedAt");
    const modifiedByColumn = getColumnByName(definition, "modifiedBy");
    const updatedAtColumn = getColumnByName(definition, "UPDATED_AT") || getColumnByName(definition, "updatedAt");

    if (idColumn && isBlankValue(beforeRow && beforeRow[idColumn.name])) {
        payload[idColumn.name] = cds.utils.uuid();
    }

    if (modifiedAtColumn) {
        payload[modifiedAtColumn.name] = now;
    }

    if (modifiedByColumn) {
        payload[modifiedByColumn.name] = user;
    }

    if (updatedAtColumn) {
        payload[updatedAtColumn.name] = now;
    }

    await validateBusinessKeyUniqueness(db, definition, Object.assign({}, beforeRow, payload), keys);
    await validateValueHelpValues(db, definition, payload);
    await validateCustomRules(db, definition.schemaName, definition.tableName, Object.assign({}, beforeRow, payload));

    const editableColumns = definition.columns
        .filter((column) => !column.key && (!isManagedField(column.name) || SYSTEM_TIMESTAMPS.has(normalizeColumnName(column.name)) || SYSTEM_USERS.has(normalizeColumnName(column.name))) && payload[column.name] !== undefined)
        .map((column) => ({
            ...column,
            value: normalizeValue(column, payload[column.name])
        }))
        .filter((column) => column.value !== undefined);

    if (!editableColumns.length) {
        throw new Error("No values provided to update the selected row.");
    }

    const where = buildWhereClause(keys, definition.keyColumns, definition.columns);
    const sql = `UPDATE ${quoteIdentifier(definition.schemaName)}.${quoteIdentifier(definition.tableName)}
        SET ${editableColumns.map((column) => `${quoteIdentifier(column.name)} = ?`).join(", ")}
        WHERE ${where.clause}`;

    await executeStatement(db, sql, editableColumns.map((column) => column.value).concat(where.values));
    await writeChangeLog(db, definition, "update", keys, beforeRow, Object.assign({}, beforeRow, payload), req);
}

async function deleteRow(db, definition, keys, req) {
    const beforeRow = await readRowByKeys(db, definition, keys);
    const where = buildWhereClause(keys, definition.keyColumns, definition.columns);
    const sql = `DELETE FROM ${quoteIdentifier(definition.schemaName)}.${quoteIdentifier(definition.tableName)}
        WHERE ${where.clause}`;

    await executeStatement(db, sql, where.values);
    await writeChangeLog(db, definition, "delete", keys, beforeRow, null, req);
}

const getRequestUser = (req) => {
    const headers = req?.headers || req?.http?.req?.headers || {};
    const tokenPayload = decodeJwtPayload(getAuthTokenFromHeaders(headers));
    const authInfo = req?.authInfo || req?.user?.authInfo || cds.context?.user?.authInfo;
    const logonName = authInfo?.getLogonName?.()
        || authInfo?.getUserInfo?.()?.logonName
        || authInfo?.token?.email
        || authInfo?.token?.user_name;
    const headerUser = getUserFromJwtPayload(tokenPayload);
    const userId = req?.user?.id && req.user.id !== "anonymous" ? req.user.id : null;

    return userId
        || req?.user?.loginName
        || req?.user?.name
        || logonName
        || headerUser
        || cds.context?.user?.id
        || cds.context?.user?.name
        || "anonymous";
};

// isConfigTable is defined at the top

const isUserAdmin = (req) => {
    if (req?.user && typeof req.user.is === "function" && req.user.is("ZTM_Admin")) {
        return true;
    }
    if (cds.context?.user && typeof cds.context.user.is === "function" && cds.context.user.is("ZTM_Admin")) {
        return true;
    }
    const headers = req?.headers || req?.http?.req?.headers || {};
    const token = getAuthTokenFromHeaders(headers);
    if (token) {
        const payload = decodeJwtPayload(token);
        if (payload && payload.xs && payload.xs.scopes) {
            return payload.xs.scopes.some(scope => scope.endsWith(".ZTM_Admin") || scope === "ZTM_Admin");
        }
        if (payload && payload.scopes) {
            return payload.scopes.some(scope => scope.endsWith(".ZTM_Admin") || scope === "ZTM_Admin");
        }
    }
    const user = String(getRequestUser(req) || "").toLowerCase();
    if (user === "amith.vandana.incture@beamsuntory.com" ||
        user === "ashutosh.shukla@beamsuntory.com" ||
        user === "amith.vandana.incture" ||
        user === "ashutosh.shukla") {
        return true;
    }
    if (process.env.NODE_ENV !== "production") {
        if (user === "alice" || user === "admin" || user === "developer") {
            return true;
        }
    }
    return false;
};

const isUserDisplayRole = (req) => {
    if (req?.user && typeof req.user.is === "function" && req.user.is("ZTM_Display")) {
        return true;
    }
    if (cds.context?.user && typeof cds.context.user.is === "function" && cds.context.user.is("ZTM_Display")) {
        return true;
    }
    const headers = req?.headers || req?.http?.req?.headers || {};
    const token = getAuthTokenFromHeaders(headers);
    if (token) {
        const payload = decodeJwtPayload(token);
        if (payload && payload.xs && payload.xs.scopes) {
            return payload.xs.scopes.some(scope => scope.endsWith(".ZTM_Display") || scope === "ZTM_Display");
        }
        if (payload && payload.scopes) {
            return payload.scopes.some(scope => scope.endsWith(".ZTM_Display") || scope === "ZTM_Display");
        }
    }
    const user = String(getRequestUser(req) || "").toLowerCase();
    if (user === "amith.vandana.incture@beamsuntory.com" ||
        user === "ashutosh.shukla@beamsuntory.com" ||
        user === "amith.vandana.incture" ||
        user === "ashutosh.shukla") {
        return true;
    }
    if (process.env.NODE_ENV !== "production") {
        if (user === "viewer" || user === "display") {
            return true;
        }
    }
    return false;
};

const isUserDataEngineer = (req) => {
    if (isUserAdmin(req)) {
        return true;
    }
    if (req?.user && typeof req.user.is === "function" && req.user.is("ZTM_DataEngineer")) {
        return true;
    }
    if (cds.context?.user && typeof cds.context.user.is === "function" && cds.context.user.is("ZTM_DataEngineer")) {
        return true;
    }
    const headers = req?.headers || req?.http?.req?.headers || {};
    const token = getAuthTokenFromHeaders(headers);
    if (token) {
        const payload = decodeJwtPayload(token);
        if (payload && payload.xs && payload.xs.scopes) {
            return payload.xs.scopes.some(scope => scope.endsWith(".ZTM_DataEngineer") || scope === "ZTM_DataEngineer");
        }
        if (payload && payload.scopes) {
            return payload.scopes.some(scope => scope.endsWith(".ZTM_DataEngineer") || scope === "ZTM_DataEngineer");
        }
    }
    if (process.env.NODE_ENV !== "production") {
        const user = getRequestUser(req);
        if (user === "bob" || user === "engineer") {
            return true;
        }
    }
    return false;
};

const isUserDataSteward = (req) => {
    if (isUserDataEngineer(req)) {
        return true;
    }
    if (req?.user && typeof req.user.is === "function" && req.user.is("ZTM_DataSteward")) {
        return true;
    }
    if (cds.context?.user && typeof cds.context.user.is === "function" && cds.context.user.is("ZTM_DataSteward")) {
        return true;
    }
    const headers = req?.headers || req?.http?.req?.headers || {};
    const token = getAuthTokenFromHeaders(headers);
    if (token) {
        const payload = decodeJwtPayload(token);
        if (payload && payload.xs && payload.xs.scopes) {
            return payload.xs.scopes.some(scope => scope.endsWith(".ZTM_DataSteward") || scope === "ZTM_DataSteward");
        }
        if (payload && payload.scopes) {
            return payload.scopes.some(scope => scope.endsWith(".ZTM_DataSteward") || scope === "ZTM_DataSteward");
        }
    }
    if (process.env.NODE_ENV !== "production") {
        const user = getRequestUser(req);
        if (user === "steward" || user === "stewardess" || user === "user") {
            return true;
        }
    }
    return false;
};

async function resolveTableAccessContext(db, schemaName, req) {
    await ensureAccessConfigTables(db, schemaName);

    const allMappings = await getRoleTemplateTableMappings(db, schemaName);
    const roleTemplateDefinitions = await getRoleTemplateDefinitions(db, schemaName);
    const roleLookup = buildTemplateRoleLookup(allMappings);
    const tableLookup = buildRoleTemplateTableLookup(allMappings);
    const roleAssignmentsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier(USER_ROLE_TEMPLATE_ACCESS_TABLE)}`;
    const tableAssignmentsTable = `${quoteIdentifier(schemaName)}.${quoteIdentifier(USER_TABLE_ACCESS_TABLE)}`;
    const [roleAssignmentCountRow] = await executeQuery(
        db,
        `SELECT COUNT(*) AS "COUNT" FROM ${roleAssignmentsTable}`,
        []
    );
    const [tableAssignmentCountRow] = await executeQuery(
        db,
        `SELECT COUNT(*) AS "COUNT" FROM ${tableAssignmentsTable}`,
        []
    );

    const accessConfigEnabled = allMappings.length > 0
        || Number(roleAssignmentCountRow?.COUNT || 0) > 0
        || Number(tableAssignmentCountRow?.COUNT || 0) > 0;
    const templateRoleAttributeNames = toAttributeNameList(
        process.env.ZTM_TEMPLATE_ROLE_ATTRIBUTE_NAMES,
        DEFAULT_TEMPLATE_ROLE_ATTRIBUTE_NAMES
    );
    const tableAccessAttributeNames = toAttributeNameList(
        process.env.ZTM_TABLE_ACCESS_ATTRIBUTE_NAMES,
        DEFAULT_TABLE_ACCESS_ATTRIBUTE_NAMES
    );
    const attributeTemplateRoles = new Set(
        getRequestAttributeValues(req, templateRoleAttributeNames).map(normalizeRoleTemplateKey).filter(Boolean)
    );
    const attributeDirectTables = new Set(
        expandTableAttributeValues(getRequestAttributeValues(req, tableAccessAttributeNames))
            .map(normalizeAccessTableName)
            .filter(Boolean)
    );
    const userEmail = normalizeUserEmail(getRequestUser(req));
    const assignedTemplateRoles = new Set(
        (await getUserRoleTemplateAssignments(db, schemaName, userEmail))
            .map(normalizeRoleTemplateKey)
            .filter(Boolean)
    );
    const directTables = new Set(
        (await getUserTableAssignments(db, schemaName, userEmail))
            .map(normalizeAccessTableName)
            .filter(Boolean)
    );
    const accessibleTables = new Set();
    const accessibleTemplateRoles = new Set();
    const hasFullAccess = isUserAdmin(req) || isUserDataEngineer(req);
    const effectiveTemplateRoles = new Set([
        ...Array.from(attributeTemplateRoles),
        ...Array.from(assignedTemplateRoles)
    ]);
    const effectiveDirectTables = new Set([
        ...Array.from(attributeDirectTables),
        ...Array.from(expandTableAttributeValues(Array.from(directTables)))
    ]);

    if (hasFullAccess) {
        roleTemplateDefinitions.forEach((entry) => {
            accessibleTemplateRoles.add(entry.key);
        });
        allMappings.forEach((mapping) => {
            accessibleTables.add(mapping.tableName);
            accessibleTemplateRoles.add(mapping.templateRole);
        });
    }

    effectiveTemplateRoles.forEach((templateRole) => {
        if (!roleTemplateDefinitions.some((entry) => entry.key === templateRole)) {
            return;
        }
        accessibleTemplateRoles.add(templateRole);
        (roleLookup.get(templateRole) || []).forEach((tableName) => {
            accessibleTables.add(tableName);
        });
    });

    effectiveDirectTables.forEach((tableName) => {
        accessibleTables.add(tableName);
        (tableLookup.get(tableName) || []).forEach((templateRole) => {
            accessibleTemplateRoles.add(templateRole);
        });
    });

    return {
        userEmail,
        accessConfigEnabled,
        hasFullAccess,
        assignedTemplateRoles: Array.from(effectiveTemplateRoles).sort(),
        directTables: Array.from(effectiveDirectTables).sort(),
        accessibleTables,
        accessibleTemplateRoles: Array.from(accessibleTemplateRoles).sort(),
        roleTemplateDefinitions,
        tableRoleLookup: tableLookup,
        roleTableLookup: roleLookup
    };
}

function enrichTablesWithRoleTemplates(tables, tableRoleLookup) {
    return (tables || []).map((table) => ({
        ...table,
        templateRoles: (tableRoleLookup.get(table.name) || []).slice().sort()
    }));
}

function filterTablesByAccess(tables, accessContext) {
    if (!accessContext) {
        return tables;
    }

    if (accessContext.hasFullAccess) {
        return tables;
    }

    return (tables || []).filter((table) => accessContext.accessibleTables.has(table.name));
}

async function assertUserCanAccessTable(db, schemaName, tableName, req) {
    if (isConfigTable(tableName)) {
        if (isUserDisplayRole(req) || isUserDataSteward(req) || isUserDataEngineer(req) || isUserAdmin(req)) {
            return;
        }
        throw new Error("You are not authorized to access configuration tables.");
    }

    const accessContext = await resolveTableAccessContext(db, schemaName, req);
    if (accessContext.hasFullAccess) {
        return;
    }
    if (!accessContext.accessibleTables.has(tableName)) {
        throw new Error(`You are not authorized to access table ${tableName}.`);
    }
}

async function getBtpUsersFromIdp(searchValue = "") {
    const serviceUrl = String(process.env.BTP_IDP_SCIM_URL || "").trim();
    const bearerToken = String(process.env.BTP_IDP_SCIM_TOKEN || "").trim();
    const basicUser = String(process.env.BTP_IDP_SCIM_USERNAME || "").trim();
    const basicPassword = String(process.env.BTP_IDP_SCIM_PASSWORD || "").trim();

    if (!serviceUrl) {
        throw new Error("BTP user lookup is not configured. Set BTP_IDP_SCIM_URL for the default identity provider.");
    }

    if (typeof fetch !== "function") {
        throw new Error("Global fetch is not available in the current Node.js runtime.");
    }

    const requestUrl = new URL(serviceUrl);
    requestUrl.searchParams.set("filter", "active eq true");
    requestUrl.searchParams.set("count", "200");
    requestUrl.searchParams.set("startIndex", "1");

    const headers = {
        Accept: "application/scim+json, application/json"
    };

    if (bearerToken) {
        headers.Authorization = `Bearer ${bearerToken}`;
    } else if (basicUser || basicPassword) {
        headers.Authorization = `Basic ${Buffer.from(`${basicUser}:${basicPassword}`).toString("base64")}`;
    } else {
        throw new Error("BTP user lookup credentials are missing. Set BTP_IDP_SCIM_TOKEN or BTP_IDP_SCIM_USERNAME/BTP_IDP_SCIM_PASSWORD.");
    }

    const response = await fetch(requestUrl.toString(), {
        method: "GET",
        headers
    });

    if (!response.ok) {
        const details = await response.text();
        throw new Error(`BTP user lookup failed with status ${response.status}: ${details}`);
    }

    const payload = await response.json();
    const normalizedSearch = String(searchValue || "").trim().toLowerCase();
    const users = (payload.Resources || [])
        .map((resource) => {
            const emails = Array.isArray(resource.emails) ? resource.emails : [];
            const primaryEmail = emails.find((entry) => entry && entry.primary && entry.value)
                || emails.find((entry) => entry && entry.value)
                || null;
            const email = normalizeUserEmail(primaryEmail?.value || resource.userName || "");
            const displayName = String(resource.displayName || resource.name?.formatted || resource.userName || email);
            const userName = String(resource.userName || email);
            const active = resource.active !== false;

            return {
                key: email || userName,
                email: email || userName,
                userName,
                displayName,
                active,
                text: email && displayName && displayName !== email ? `${email} - ${displayName}` : (email || displayName || userName)
            };
        })
        .filter((entry) => entry.active && entry.key)
        .filter((entry) => {
            if (!normalizedSearch) {
                return true;
            }
            return entry.email.includes(normalizedSearch)
                || entry.userName.toLowerCase().includes(normalizedSearch)
                || entry.displayName.toLowerCase().includes(normalizedSearch);
        })
        .sort((left, right) => left.text.localeCompare(right.text));

    return users;
}

const formatAuditValue = (value) => {
    if (value === undefined || value === null) {
        return null;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }

    return String(value);
};

const getEntityKeyValue = (definition, row) => {
    if (row && row.ID) {
        return formatAuditValue(row.ID);
    }

    const values = (definition.keyColumns || []).map((keyName) => row[keyName]);

    if (!values.length) {
        return "";
    }

    if (values.length === 1) {
        return formatAuditValue(values[0]);
    }

    return JSON.stringify(
        definition.keyColumns.reduce((acc, keyName) => {
            acc[keyName] = row[keyName];
            return acc;
        }, {})
    );
};

const getChangeLogText = (definition) => `${definition.schemaName}.${definition.tableName}`;

const getChangeColumns = (definition, beforeRow, afterRow, action) => {
    const rows = [];

    definition.columns.forEach((column) => {
        if (isManagedField(column.name)) {
            return;
        }

        const oldValue = beforeRow ? beforeRow[column.name] : undefined;
        const newValue = afterRow ? afterRow[column.name] : undefined;

        if (action === "create" && newValue !== undefined && newValue !== null && newValue !== "") {
            rows.push({
                attribute: column.name,
                valueChangedFrom: null,
                valueChangedTo: formatAuditValue(newValue),
                valueDataType: column.type
            });
        } else if (action === "delete" && oldValue !== undefined && oldValue !== null && oldValue !== "") {
            rows.push({
                attribute: column.name,
                valueChangedFrom: formatAuditValue(oldValue),
                valueChangedTo: null,
                valueDataType: column.type
            });
        } else if (action === "update" && formatAuditValue(oldValue) !== formatAuditValue(newValue)) {
            rows.push({
                attribute: column.name,
                valueChangedFrom: formatAuditValue(oldValue),
                valueChangedTo: formatAuditValue(newValue),
                valueDataType: column.type
            });
        }
    });

    return rows;
};

async function readRowByKeys(db, definition, keys) {
    const where = buildWhereClause(keys, definition.keyColumns, definition.columns);
    const sql = `SELECT * FROM ${quoteIdentifier(definition.schemaName)}.${quoteIdentifier(definition.tableName)}
        WHERE ${where.clause}`;
    const [row] = await executeQuery(db, sql, where.values);
    return row;
}

async function writeChangeLog(db, definition, action, keys, beforeRow, afterRow, req) {
    const changeId = cds.utils.uuid();
    const now = new Date();
    const user = getRequestUser(req);
    const entityKey = getEntityKeyValue(definition, afterRow || beforeRow || keys || {});
    const changes = getChangeColumns(definition, beforeRow, afterRow, action);

    if (!changes.length) {
        return;
    }

    try {
        await db.run(
            INSERT.into("sap.changelog.ChangeLog").entries({
                ID: changeId,
                createdAt: now,
                createdBy: user,
                modifiedAt: now,
                modifiedBy: user,
                serviceEntity: getChangeLogText(definition),
                entity: getChangeLogText(definition),
                entityKey
            })
        );

        for (const change of changes) {
            await db.run(
                INSERT.into("sap.changelog.Changes").entries({
                    ID: cds.utils.uuid(),
                    keys: JSON.stringify(keys || {}),
                    attribute: change.attribute,
                    valueChangedFrom: change.valueChangedFrom,
                    valueChangedTo: change.valueChangedTo,
                    entityID: entityKey,
                    entity: getChangeLogText(definition),
                    serviceEntity: getChangeLogText(definition),
                    parentEntityID: null,
                    parentKey: null,
                    serviceEntityPath: `${getChangeLogText(definition)}(${entityKey})`,
                    modification: action,
                    valueDataType: change.valueDataType,
                    changeLog_ID: changeId,
                    createdAt: now,
                    createdBy: user
                })
            );
        }
    } catch (error) {
        console.warn("change log write skipped:", error.message);
    }
}

cds.on("bootstrap", (app) => {
    app.use(express.json({ limit: "5mb" }));

    app.get("/public/logout", (req, res) => {
        const redirectUrl = req.query.redirect || "/";
        res.setHeader("Content-Type", "text/html");
        res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Logged Out</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: linear-gradient(135deg, #0e2947 0%, #1f4f82 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            color: #ffffff;
        }
        .container {
            text-align: center;
            background: rgba(255, 255, 255, 0.1);
            padding: 3rem 2.5rem;
            border-radius: 1.25rem;
            box-shadow: 0 1rem 2.5rem rgba(0, 0, 0, 0.2);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.15);
            max-width: 400px;
            width: 90%;
        }
        .icon {
            font-size: 4rem;
            margin-bottom: 1.5rem;
            color: #79a1da;
        }
        h1 {
            font-size: 1.75rem;
            margin-bottom: 0.75rem;
            font-weight: 700;
        }
        p {
            font-size: 0.95rem;
            color: rgba(255, 255, 255, 0.8);
            margin-bottom: 2rem;
            line-height: 1.5;
        }
        .btn {
            display: inline-block;
            background: #ffffff;
            color: #0e2947;
            padding: 0.75rem 2rem;
            border-radius: 0.6rem;
            text-decoration: none;
            font-weight: 600;
            transition: background 0.2s;
        }
        .btn:hover {
            background: #f0f4f9;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✓</div>
        <h1>Logged Out</h1>
        <p>You have been signed out successfully. For security reasons, we recommend closing this browser tab.</p>
        <a id="loginAgainBtn" href="${redirectUrl}" class="btn">Log In Again</a>
    </div>
    <script>
        // Push state to history to intercept back button
        history.pushState(null, null, window.location.href);
        window.addEventListener('popstate', function (event) {
            window.location.href = "${redirectUrl}";
        });
    </script>
</body>
</html>
        `);
    });

    app.get("/api/schema-browser/user-info", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const username = getRequestUser(req);
                const isDisplay = isUserDisplayRole(req);
                const isAdmin = isUserAdmin(req);
                const isDataEngineer = isUserDataEngineer(req);
                const isDataSteward = isUserDataSteward(req);
                const headers = req.headers || {};
                const tokenPayload = decodeJwtPayload(getAuthTokenFromHeaders(headers));
                let email = tokenPayload?.email || tokenPayload?.user_name || "";
                if (!email && username.includes("@")) {
                    email = username;
                }
                if (!email) {
                    email = username + "@example.com";
                }

                const currentSchema = await getCurrentSchema(db);
                const accessContext = await resolveTableAccessContext(db, currentSchema, req);
                const roleTemplateDefinitions = accessContext.roleTemplateDefinitions || [];
                const templateRoleItems = accessContext.accessibleTemplateRoles.map((templateRole) => ({
                    key: templateRole,
                    text: getRoleTemplateLabel(templateRole, roleTemplateDefinitions)
                }));
                const vcap = JSON.parse(process.env.VCAP_APPLICATION || "{}");
                const srvUrl = vcap.uris ? "https://" + vcap.uris[0] : "";
                const logoutRedirectUrl = srvUrl ? srvUrl + "/public/logout" : "/public/logout";

                res.json({
                    username,
                    email,
                    isDisplay,
                    isAdmin,
                    isDataEngineer,
                    isDataSteward,
                    logoutRedirectUrl,
                    accessConfigEnabled: accessContext.accessConfigEnabled,
                    accessibleTemplateRoles: accessContext.accessibleTemplateRoles,
                    roleTemplateDefinitions,
                    templateRoleItems
                });
            });
        } catch (error) {
            console.error("user-info failed:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/admin/btp-users", async (req, res) => {
        try {
            if (!isUserAdmin(req) && !isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can search BTP users." });
            }

            const users = await getBtpUsersFromIdp(req.query.search || "");
            res.json({ users, configured: true });
        } catch (error) {
            console.error("btp-users lookup failed:", error);
            res.status(500).json({ error: error.message, configured: false });
        }
    });

    app.get("/api/schema-browser/template-roles", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const accessContext = await resolveTableAccessContext(db, schemaName, req);
                const roleTemplateDefinitions = accessContext.roleTemplateDefinitions || [];
                const templateRoles = accessContext.hasFullAccess
                    ? roleTemplateDefinitions
                    : roleTemplateDefinitions.filter((entry) => accessContext.accessibleTemplateRoles.includes(entry.key));
                res.json({
                    schemaName,
                    templateRoles
                });
            });
        } catch (error) {
            console.error("template-roles failed:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/schema-browser/schemas", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const rows = await executeQuery(db, `
                    SELECT SCHEMA_NAME 
                    FROM SYS.SCHEMAS 
                    WHERE SCHEMA_NAME NOT LIKE '\\_SYS\\_%' ESCAPE '\\' 
                      AND SCHEMA_NAME NOT LIKE 'SYS%' 
                      AND SCHEMA_NAME NOT LIKE 'SAP%' 
                    ORDER BY SCHEMA_NAME
                `);
                
                const schemas = rows.map(r => ({ name: r.SCHEMA_NAME }));
                const currentSchema = await getCurrentSchema(db);
                
                if (!schemas.some(s => s.name === currentSchema)) {
                    schemas.unshift({ name: currentSchema });
                }
                
                res.json({ schemas, currentSchema });
            });
        } catch (error) {
            console.error("schema-browser/schemas failed:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/schema-browser/tables", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const accessContext = await resolveTableAccessContext(db, schemaName, req);
                const tables = filterTablesByAccess(
                    enrichTablesWithRoleTemplates(await getTables(db, schemaName), accessContext.tableRoleLookup),
                    accessContext
                );

                res.json({
                    schemaName,
                    tables,
                    accessConfigEnabled: accessContext.accessConfigEnabled,
                    accessibleTemplateRoles: accessContext.accessibleTemplateRoles
                });
            });
        } catch (error) {
            console.error("schema-browser/tables failed:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.get("/api/schema-browser/columns", async (req, res) => {
        try {
            const { tableName, schemaName: requestedSchema } = req.query;
            if (!tableName) {
                return res.status(400).json({ error: "Missing tableName" });
            }

            await withDbClient(async (db) => {
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const sql = `
                    SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE, DEFAULT_VALUE
                    FROM SYS.TABLE_COLUMNS
                    WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?
                    UNION ALL
                    SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE, NULL AS DEFAULT_VALUE
                    FROM SYS.VIEW_COLUMNS
                    WHERE SCHEMA_NAME = ? AND VIEW_NAME = ?
                    ORDER BY POSITION
                `;
                const columns = await executeQuery(db, sql, [schemaName, tableName, schemaName, tableName]);
                res.json(columns);
            });
        } catch (error) {
            console.error("schema-browser/columns failed:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/schema-browser/tables", async (req, res) => {
        try {
            if (!isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can perform table structure modifications." });
            }
            const { tableName, tableType, tableComment, templateRole, fields, includeCuid, includeManaged, includeTemporal, includeCodeList, validationRules } = req.body;
            if (!tableName || ((!fields || !fields.length) && !includeCuid && !includeManaged && !includeTemporal && !includeCodeList)) {
                return res.status(400).json({ error: "Missing tableName or fields" });
            }

            const processedFields = normalizePrimaryKeyFields([...(fields || [])]);

            if (includeCuid) {
                processedFields.unshift({ name: "ID", type: "NVARCHAR", length: 36, isPrimary: true, isNotNull: true, comment: "UUID" });
            }
            if (includeManaged) {
                processedFields.push(
                    { name: "createdAt", type: "TIMESTAMP", isPrimary: false, isNotNull: false, comment: "Created At" },
                    { name: "createdBy", type: "NVARCHAR", length: 255, isPrimary: false, isNotNull: false, comment: "Created By" },
                    { name: "modifiedAt", type: "TIMESTAMP", isPrimary: false, isNotNull: false, comment: "Modified At" },
                    { name: "modifiedBy", type: "NVARCHAR", length: 255, isPrimary: false, isNotNull: false, comment: "Modified By" }
                );
            }
            if (includeTemporal) {
                processedFields.push(
                    { name: "validFrom", type: "TIMESTAMP", isPrimary: false, isNotNull: false, comment: "Valid From" },
                    { name: "validTo", type: "TIMESTAMP", isPrimary: false, isNotNull: false, comment: "Valid To" }
                );
            }
            if (includeCodeList) {
                processedFields.push(
                    { name: "name", type: "NVARCHAR", length: 255, isPrimary: false, isNotNull: false, comment: "Name" },
                    { name: "descr", type: "NVARCHAR", length: 1000, isPrimary: false, isNotNull: false, comment: "Description" }
                );
            }

            await withDbClient(async (db) => {
                const requestedSchema = req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const isRowStore = String(tableType || "").toUpperCase() === "ROW";
                const createPrefix = isRowStore ? "CREATE ROW TABLE" : "CREATE COLUMN TABLE";

                await validateFieldMetadataConfiguration(db, schemaName, processedFields);
                
                const columnDefs = processedFields.map(f => {
                    let colDef = `${quoteIdentifier(f.name)} ${f.type}`;
                    const typeUpper = String(f.type || "").toUpperCase();
                    
                    if (f.length && ["VARCHAR", "NVARCHAR", "VARBINARY", "DECIMAL"].includes(typeUpper)) {
                        if (typeUpper === "DECIMAL") {
                            colDef += `(${f.length}${f.scale ? ',' + f.scale : ''})`;
                        } else {
                            colDef += `(${f.length})`;
                        }
                    }
                    
                    if (f.defaultValue !== undefined && f.defaultValue !== "") {
                        colDef += ` DEFAULT '${String(f.defaultValue).replace(/'/g, "''")}'`;
                    }
                    if (f.isNotNull || f.isPrimary) {
                        colDef += " NOT NULL";
                    }
                    return colDef;
                });
                
                const primaryKeys = processedFields.filter(f => f.isPrimary).map(f => quoteIdentifier(f.name));
                if (primaryKeys.length > 0) {
                    columnDefs.push(`PRIMARY KEY (${primaryKeys.join(", ")})`);
                }
                
                const sql = `${createPrefix} ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} (\n    ${columnDefs.join(",\n    ")}\n)`;
                await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                
                if (tableComment) {
                    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [`COMMENT ON TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} IS '${String(tableComment).replace(/'/g, "''")}'`]);
                }
                
                for (const f of processedFields) {
                    if (f.comment) {
                        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [`COMMENT ON COLUMN ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}.${quoteIdentifier(f.name)} IS '${String(f.comment).replace(/'/g, "''")}'`]);
                    }
                }

                await replaceFieldMetadata(db, schemaName, tableName, processedFields);
                await upsertSchemaValueHelpConfig(db, schemaName, processedFields);
                await upsertSchemaValueHelpAliases(db, schemaName, processedFields);
                await upsertRoleTemplateTableMapping(db, schemaName, templateRole, tableName);

                // Save validation rules
                await ensureValidationRulesTable(db, schemaName);
                await executeStatement(
                    db,
                    `DELETE FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALIDATION_RULES_TABLE)}
                      WHERE SCHEMA_NAME = ?
                        AND TABLE_NAME = ?`,
                    [schemaName, tableName]
                );

                for (const rule of validationRules || []) {
                    if (!rule.columnName || !rule.ruleType) {
                        continue;
                    }
                    await executeStatement(
                        db,
                        `INSERT INTO ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALIDATION_RULES_TABLE)}
                            ("SCHEMA_NAME", "TABLE_NAME", "COLUMN_NAME", "RULE_TYPE", "RULE_VALUE", "ERROR_MESSAGE", "UPDATED_AT")
                         VALUES (?, ?, ?, ?, ?, ?, CURRENT_UTCTIMESTAMP)`,
                        [
                            schemaName,
                            tableName,
                            rule.columnName,
                            rule.ruleType,
                            rule.ruleValue || null,
                            rule.errorMessage || null
                        ]
                    );
                }
            });

            res.json({ success: true, message: "Table created successfully" });
        } catch (err) {
            console.error("Error creating table:", err);
            res.status(500).json({ error: err.message || "Failed to create table" });
        }
    });

    app.delete("/api/schema-browser/tables/:tableName", async (req, res) => {
        try {
            if (!isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can perform table structure modifications." });
            }
            const { tableName } = req.params;
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const sql = `DROP TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
                await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                await deleteFieldMetadata(db, schemaName, tableName);
                await deleteRoleTemplateTableMappings(db, schemaName, tableName);
                await deleteUserTableAssignments(db, schemaName, tableName);
            });
            res.json({ success: true, message: "Table dropped successfully" });
        } catch (err) {
            console.error("Error dropping table:", err);
            res.status(500).json({ error: err.message || "Failed to drop table" });
        }
    });

    app.patch("/api/schema-browser/tables/:tableName", async (req, res) => {
        try {
            if (!isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can perform table structure modifications." });
            }
            const { tableName } = req.params;
            const { fields } = req.body;
            
            if (!fields || !fields.length) {
                return res.status(400).json({ error: "Missing fields" });
            }

            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await alterTableDefinition(db, schemaName, tableName, fields);
            });

            res.json({ success: true, message: "Table altered successfully" });
        } catch (err) {
            console.error("Error altering table:", err);
            res.status(isUserFacingValidationError(err) ? 400 : 500).json({ error: err.message || "Failed to alter table" });
        }
    });

    app.get("/api/schema-browser/tables/:table/metadata", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await assertUserCanAccessTable(db, schemaName, req.params.table, req);
                const definition = await getTableDefinition(db, schemaName, req.params.table);

                res.json(definition);
            });
        } catch (error) {
            console.error("schema-browser/metadata failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.get("/api/schema-browser/value-help-config/:semanticType", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const config = await getSchemaValueHelpConfigBySemanticType(db, schemaName, req.params.semanticType);

                res.json(config || {});
            });
        } catch (error) {
            console.error("schema-browser/value-help-config failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.get("/api/schema-browser/tables/:table/value-help/:column", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await assertUserCanAccessTable(db, schemaName, req.params.table, req);
                const definition = await getTableDefinition(db, schemaName, req.params.table);
                const column = (definition.columns || []).find((entry) => normalizeColumnName(entry.name) === normalizeColumnName(req.params.column));

                if (!column || !column.valueHelpRequired || !column.referenceTable || !column.referenceColumn) {
                    return res.json({ values: [] });
                }

                const referenceColumns = await getColumns(db, schemaName, column.referenceTable);
                const descriptionColumn = findValueHelpDescriptionColumn(referenceColumns, column.referenceColumn);
                const descriptionSelect = descriptionColumn
                    ? `, ${quoteIdentifier(descriptionColumn.name)} AS "DESCRIPTION"`
                    : "";
                const orderBy = descriptionColumn
                    ? `${quoteIdentifier(column.referenceColumn)}, ${quoteIdentifier(descriptionColumn.name)}`
                    : `${quoteIdentifier(column.referenceColumn)}`;

                const rows = await executeQuery(
                    db,
                    `SELECT DISTINCT ${quoteIdentifier(column.referenceColumn)} AS "VALUE"${descriptionSelect}
                       FROM ${formatTableReference(schemaName, column.referenceTable)}
                      WHERE ${quoteIdentifier(column.referenceColumn)} IS NOT NULL
                      ORDER BY ${orderBy}`,
                    []
                );

                res.json({
                    values: rows.map((row) => ({
                        key: String(row.VALUE),
                        text: row.DESCRIPTION ? `${row.VALUE} - ${row.DESCRIPTION}` : String(row.VALUE),
                        description: row.DESCRIPTION ? String(row.DESCRIPTION) : ""
                    })),
                    descriptionColumn: descriptionColumn ? descriptionColumn.name : ""
                });
            });
        } catch (error) {
            console.error("schema-browser/value-help failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.get("/api/schema-browser/tables/:table/rows", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await assertUserCanAccessTable(db, schemaName, req.params.table, req);
                const definition = await getTableDefinition(db, schemaName, req.params.table);
                const result = await readRows(db, definition, req.query.search);

                res.json({
                    ...definition,
                    ...result
                });
            });
        } catch (error) {
            console.error("schema-browser/rows GET failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.post("/api/schema-browser/tables/:table/rows", async (req, res) => {
        try {
            if (!isUserDataSteward(req)) {
                return res.status(403).json({ error: "Only authorized users can modify data records." });
            }
            if (isConfigTable(req.params.table) && !isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can modify configuration tables." });
            }
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await assertUserCanAccessTable(db, schemaName, req.params.table, req);
                const definition = await getTableDefinition(db, schemaName, req.params.table);
                await insertRow(db, definition, req.body.data || {}, req);
            });

            res.status(201).json({ success: true });
        } catch (error) {
            console.error("schema-browser/rows POST failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.patch("/api/schema-browser/tables/:table/rows", async (req, res) => {
        try {
            if (!isUserDataSteward(req)) {
                return res.status(403).json({ error: "Only authorized users can modify data records." });
            }
            if (isConfigTable(req.params.table) && !isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can modify configuration tables." });
            }
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await assertUserCanAccessTable(db, schemaName, req.params.table, req);
                const definition = await getTableDefinition(db, schemaName, req.params.table);
                await updateRow(db, definition, req.body.keys || {}, req.body.data || {}, req);
            });

            res.json({ success: true });
        } catch (error) {
            console.error("schema-browser/rows PATCH failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.delete("/api/schema-browser/tables/:table/rows", async (req, res) => {
        try {
            if (!isUserDataSteward(req)) {
                return res.status(403).json({ error: "Only authorized users can modify data records." });
            }
            if (isConfigTable(req.params.table) && !isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can modify configuration tables." });
            }
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await assertUserCanAccessTable(db, schemaName, req.params.table, req);
                const definition = await getTableDefinition(db, schemaName, req.params.table);
                await deleteRow(db, definition, req.body.keys || {}, req);
            });

            res.json({ success: true });
        } catch (error) {
            console.error("schema-browser/rows DELETE failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.post("/api/schema-browser/tables/:table/mass-update", async (req, res) => {
        try {
            if (!isUserDataSteward(req)) {
                return res.status(403).json({ error: "Only authorized users can modify data records." });
            }
            if (isConfigTable(req.params.table) && !isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can modify configuration tables." });
            }
            const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
            const changes = req.body.data || {};

            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await assertUserCanAccessTable(db, schemaName, req.params.table, req);
                const definition = await getTableDefinition(db, schemaName, req.params.table);

                for (const keys of rows) {
                    await updateRow(db, definition, keys, changes, req);
                }
            });

            res.json({ success: true, count: rows.length });
        } catch (error) {
            console.error("schema-browser/mass-update failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.post("/api/schema-browser/tables/:table/mass-upload", async (req, res) => {
        try {
            if (!isUserDataSteward(req)) {
                return res.status(403).json({ error: "Only authorized users can modify data records." });
            }
            if (isConfigTable(req.params.table) && !isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can modify configuration tables." });
            }
            const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await assertUserCanAccessTable(db, schemaName, req.params.table, req);
                const definition = await getTableDefinition(db, schemaName, req.params.table);

                for (const row of rows) {
                    await insertRow(db, definition, row, req);
                }
            });

            res.json({ success: true, count: rows.length });
        } catch (error) {
            console.error("schema-browser/mass-upload failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.get("/api/schema-browser/validation-rules", async (req, res) => {
        try {
            const { tableName, schemaName: requestedSchema } = req.query;
            if (!tableName) {
                return res.status(400).json({ error: "Missing tableName" });
            }

            await withDbClient(async (db) => {
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await ensureValidationRulesTable(db, schemaName);

                const rules = await executeQuery(
                    db,
                    `SELECT COLUMN_NAME AS "columnName", RULE_TYPE AS "ruleType", RULE_VALUE AS "ruleValue", ERROR_MESSAGE AS "errorMessage"
                       FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALIDATION_RULES_TABLE)}
                      WHERE SCHEMA_NAME = ?
                        AND TABLE_NAME = ?
                      ORDER BY COLUMN_NAME, RULE_TYPE`,
                    [schemaName, tableName]
                );

                res.json({ rules });
            });
        } catch (error) {
            console.error("schema-browser/validation-rules GET failed:", error);
            res.status(500).json({ error: error.message });
        }
    });

    app.post("/api/schema-browser/validation-rules", async (req, res) => {
        try {
            if (!isUserDataEngineer(req)) {
                return res.status(403).json({ error: "Only administrators and data engineers can modify configuration validation rules." });
            }
            const { tableName, schemaName: requestedSchema, rules } = req.body;
            if (!tableName) {
                return res.status(400).json({ error: "Missing tableName" });
            }

            await withDbClient(async (db) => {
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await ensureValidationRulesTable(db, schemaName);

                await executeStatement(
                    db,
                    `DELETE FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALIDATION_RULES_TABLE)}
                      WHERE SCHEMA_NAME = ?
                        AND TABLE_NAME = ?`,
                    [schemaName, tableName]
                );

                for (const rule of rules || []) {
                    if (!rule.columnName || !rule.ruleType) {
                        continue;
                    }
                    await executeStatement(
                        db,
                        `INSERT INTO ${quoteIdentifier(schemaName)}.${quoteIdentifier(VALIDATION_RULES_TABLE)}
                            ("SCHEMA_NAME", "TABLE_NAME", "COLUMN_NAME", "RULE_TYPE", "RULE_VALUE", "ERROR_MESSAGE", "UPDATED_AT")
                         VALUES (?, ?, ?, ?, ?, ?, CURRENT_UTCTIMESTAMP)`,
                        [
                            schemaName,
                            tableName,
                            rule.columnName,
                            rule.ruleType,
                            rule.ruleValue || null,
                            rule.errorMessage || null
                        ]
                    );
                }
            });

            res.json({ success: true });
        } catch (error) {
            console.error("schema-browser/validation-rules POST failed:", error);
            res.status(500).json({ error: error.message });
        }
    });
});

module.exports = cds.service.impl(function () {
    const { PlantLocation, TankVolumes } = this.entities;

    this.before("*", (req) => {
        if (req.user) {
            const user = String(getRequestUser(req) || "").toLowerCase();
            if (user === "amith.vandana.incture@beamsuntory.com" || 
                user === "ashutosh.shukla@beamsuntory.com" ||
                user === "amith.vandana.incture" || 
                user === "ashutosh.shukla") {
                
                const origIs = req.user.is;
                req.user.is = function(role) {
                    if (["ZTM_Admin", "ZTM_DataEngineer", "ZTM_DataSteward", "ZTM_Display", "ZTM_Access"].includes(role)) {
                        return true;
                    }
                    return typeof origIs === "function" ? origIs.call(req.user, role) : false;
                };
            }
        }
    });

    const stampManagedFields = (req) => {
        const user = getRequestUser(req);
        const now = new Date().toISOString();
        const data = req.data || {};

        if (user && user !== "anonymous") {
            if (req.event === "CREATE") {
                data.createdBy ??= user;
            }
            data.modifiedBy = user;
        }

        if (req.event === "CREATE") {
            data.createdAt ??= now;
        }
        data.modifiedAt = now;
    };

    if (PlantLocation) {
        this.before(["CREATE", "UPDATE"], PlantLocation, stampManagedFields);
    }

    if (TankVolumes) {
        this.before(["CREATE", "UPDATE"], TankVolumes, stampManagedFields);
    }

    // OData V4 handlers for SchemaBrowserService
    this.on('getSchemas', async (req) => {
        try {
            return await withDbClient(async (db) => {
                const rows = await executeQuery(db, `
                    SELECT SCHEMA_NAME 
                    FROM SYS.SCHEMAS 
                    WHERE SCHEMA_NAME NOT LIKE '\\_SYS\\_%' ESCAPE '\\' 
                      AND SCHEMA_NAME NOT LIKE 'SYS%' 
                      AND SCHEMA_NAME NOT LIKE 'SAP%' 
                    ORDER BY SCHEMA_NAME
                `);
                
                const schemas = rows.map(r => ({ name: r.SCHEMA_NAME }));
                const currentSchema = await getCurrentSchema(db);
                
                if (!schemas.some(s => s.name === currentSchema)) {
                    schemas.unshift({ name: currentSchema });
                }
                
                return { schemas, currentSchema };
            });
        } catch (error) {
            req.reject(500, error.message);
        }
    });

    this.on('getTables', async (req) => {
        try {
            return await withDbClient(async (db) => {
                const requestedSchema = req.data.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const tables = await getTables(db, schemaName);

                return {
                    schemaName,
                    tables
                };
            });
        } catch (error) {
            req.reject(500, error.message);
        }
    });

    this.on('getColumns', async (req) => {
        try {
            const { tableName, schemaName: requestedSchema } = req.data;
            if (!tableName) {
                return req.reject(400, "Missing tableName");
            }

            return await withDbClient(async (db) => {
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const sql = `
                    SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE, DEFAULT_VALUE
                    FROM SYS.TABLE_COLUMNS
                    WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?
                    UNION ALL
                    SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE, NULL AS DEFAULT_VALUE
                    FROM SYS.VIEW_COLUMNS
                    WHERE SCHEMA_NAME = ? AND VIEW_NAME = ?
                    ORDER BY POSITION
                `;
                const columns = await executeQuery(db, sql, [schemaName, tableName, schemaName, tableName]);
                return columns.map(c => ({
                    COLUMN_NAME: c.COLUMN_NAME,
                    DATA_TYPE_NAME: c.DATA_TYPE_NAME,
                    LENGTH: c.LENGTH || null,
                    SCALE: c.SCALE || null,
                    IS_NULLABLE: c.IS_NULLABLE,
                    DEFAULT_VALUE: c.DEFAULT_VALUE || null
                }));
            });
        } catch (error) {
            req.reject(500, error.message);
        }
    });

    this.on('createTable', async (req) => {
        try {
            if (!isUserDataEngineer(req)) {
                return req.reject(403, "Only administrators and data engineers can perform table structure modifications.");
            }
            const { tableName, tableType, tableComment, templateRole, fields, includeCuid, includeManaged, includeTemporal, includeCodeList } = req.data;
            if (!tableName || ((!fields || !fields.length) && !includeCuid && !includeManaged && !includeTemporal && !includeCodeList)) {
                return req.reject(400, "Missing tableName or fields");
            }
            if (!templateRole) {
                return req.reject(400, "Missing templateRole");
            }

            const processedFields = normalizePrimaryKeyFields([...(fields || [])]);

            if (includeCuid) {
                processedFields.unshift({ name: "ID", type: "NVARCHAR", length: 36, isPrimary: true, isNotNull: true, comment: "UUID" });
            }
            if (includeManaged) {
                processedFields.push(
                    { name: "createdAt", type: "TIMESTAMP", isPrimary: false, isNotNull: false, comment: "Created At" },
                    { name: "createdBy", type: "NVARCHAR", length: 255, isPrimary: false, isNotNull: false, comment: "Created By" },
                    { name: "modifiedAt", type: "TIMESTAMP", isPrimary: false, isNotNull: false, comment: "Modified At" },
                    { name: "modifiedBy", type: "NVARCHAR", length: 255, isPrimary: false, isNotNull: false, comment: "Modified By" }
                );
            }
            if (includeTemporal) {
                processedFields.push(
                    { name: "validFrom", type: "TIMESTAMP", isPrimary: false, isNotNull: false, comment: "Valid From" },
                    { name: "validTo", type: "TIMESTAMP", isPrimary: false, isNotNull: false, comment: "Valid To" }
                );
            }
            if (includeCodeList) {
                processedFields.push(
                    { name: "name", type: "NVARCHAR", length: 255, isPrimary: false, isNotNull: false, comment: "Name" },
                    { name: "descr", type: "NVARCHAR", length: 1000, isPrimary: false, isNotNull: false, comment: "Description" }
                );
            }

            await withDbClient(async (db) => {
                const requestedSchema = req.data.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const isRowStore = String(tableType || "").toUpperCase() === "ROW";
                const createPrefix = isRowStore ? "CREATE ROW TABLE" : "CREATE COLUMN TABLE";
                
                const columnDefs = processedFields.map(f => {
                    let colDef = `${quoteIdentifier(f.name)} ${f.type}`;
                    const typeUpper = String(f.type || "").toUpperCase();
                    
                    if (f.length && ["VARCHAR", "NVARCHAR", "VARBINARY", "DECIMAL"].includes(typeUpper)) {
                        if (typeUpper === "DECIMAL") {
                            colDef += `(${f.length}${f.scale ? ',' + f.scale : ''})`;
                        } else {
                            colDef += `(${f.length})`;
                        }
                    }
                    
                    if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== "") {
                        colDef += ` DEFAULT '${String(f.defaultValue).replace(/'/g, "''")}'`;
                    }
                    if (f.isNotNull || f.isPrimary) {
                        colDef += " NOT NULL";
                    }
                    return colDef;
                });
                
                const primaryKeys = processedFields.filter(f => f.isPrimary).map(f => quoteIdentifier(f.name));
                if (primaryKeys.length > 0) {
                    columnDefs.push(`PRIMARY KEY (${primaryKeys.join(", ")})`);
                }
                
                const sql = `${createPrefix} ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} (\n    ${columnDefs.join(",\n    ")}\n)`;
                await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                
                if (tableComment) {
                    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [`COMMENT ON TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} IS '${String(tableComment).replace(/'/g, "''")}'`]);
                }
                
                for (const f of processedFields) {
                    if (f.comment) {
                        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [`COMMENT ON COLUMN ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}.${quoteIdentifier(f.name)} IS '${String(f.comment).replace(/'/g, "''")}'`]);
                    }
                }

                await replaceFieldMetadata(db, schemaName, tableName, processedFields);
                await upsertSchemaValueHelpConfig(db, schemaName, processedFields);
                await upsertSchemaValueHelpAliases(db, schemaName, processedFields);
                await upsertRoleTemplateTableMapping(db, schemaName, templateRole, tableName);
            });

            return { success: true, message: "Table created successfully" };
        } catch (err) {
            console.error("Error creating table via OData:", err);
            req.reject(500, err.message || "Failed to create table");
        }
    });

    this.on('dropTable', async (req) => {
        try {
            if (!isUserDataEngineer(req)) {
                return req.reject(403, "Only administrators and data engineers can perform table structure modifications.");
            }
            const { tableName } = req.data;
            if (!tableName) return req.reject(400, "Missing tableName");

            await withDbClient(async (db) => {
                const requestedSchema = req.data.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const sql = `DROP TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
                await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                await deleteFieldMetadata(db, schemaName, tableName);
                await deleteRoleTemplateTableMappings(db, schemaName, tableName);
                await deleteUserTableAssignments(db, schemaName, tableName);
            });
            return { success: true, message: "Table dropped successfully" };
        } catch (err) {
            console.error("Error dropping table via OData:", err);
            req.reject(500, err.message || "Failed to drop table");
        }
    });

    this.on('alterTable', async (req) => {
        try {
            if (!isUserDataEngineer(req)) {
                return req.reject(403, "Only administrators and data engineers can perform table structure modifications.");
            }
            const { tableName, fields } = req.data;
            
            if (!tableName || !fields || !fields.length) {
                return req.reject(400, "Missing tableName or fields");
            }

            await withDbClient(async (db) => {
                const requestedSchema = req.data.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                await alterTableDefinition(db, schemaName, tableName, fields);
            });

            return { success: true, message: "Table altered successfully" };
        } catch (err) {
            console.error("Error altering table via OData:", err);
            req.reject(isUserFacingValidationError(err) ? 400 : 500, err.message || "Failed to alter table");
        }
    });
});
