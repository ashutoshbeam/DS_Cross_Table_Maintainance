const cds = require("@sap/cds");
const express = require("express");

const ROW_LIMIT = 200;
const FIELD_METADATA_TABLE = "ZSCHEMA_FIELD_METADATA";
const VALUE_HELP_CONFIG_TABLE = "ZSCHEMA_VALUE_HELP_CONFIG";
const VALUE_HELP_ALIAS_TABLE = "ZSCHEMA_VALUE_HELP_ALIAS";
let dbPromise;

const MANAGED_FIELD_NAMES = new Set([
    "ID",
    "createdAt",
    "createdBy",
    "modifiedAt",
    "modifiedBy"
]);

const normalizeColumnName = (name) => String(name || "").toUpperCase();

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

const normalizeSemanticKey = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const getSemanticAliases = (value) => {
    const normalized = normalizeSemanticKey(value);
    return normalized ? [normalized] : [];
};

const getFieldMetadataPayload = (field = {}) => {
    const semanticType = String(field.semanticType || "").trim();
    const referenceTable = String(field.referenceTable || "").trim();
    const referenceColumn = String(field.referenceColumn || "").trim();
    const valueHelpRequired = field.valueHelpRequired === true
        || field.valueHelpRequired === "true"
        || !!semanticType
        || !!referenceTable
        || !!referenceColumn;

    return {
        semanticType,
        referenceTable,
        referenceColumn,
        valueHelpRequired
    };
};

const hasFieldMetadataPayload = (field = {}) => {
    const metadata = getFieldMetadataPayload(field);
    return metadata.valueHelpRequired
        || !!metadata.semanticType
        || !!metadata.referenceTable
        || !!metadata.referenceColumn;
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
        "UPDATED_AT" TIMESTAMP,
        PRIMARY KEY ("SCHEMA_NAME", "TABLE_NAME", "COLUMN_NAME")
    )`;

    await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
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

async function getFieldMetadataMap(db, schemaName, tableName) {
    await ensureFieldMetadataTable(db, schemaName);

    const rows = await executeQuery(db,
        `SELECT COLUMN_NAME,
                SEMANTIC_TYPE,
                REFERENCE_TABLE,
                REFERENCE_COLUMN,
                VALUE_HELP_REQUIRED
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
            valueHelpRequired: row.VALUE_HELP_REQUIRED === true || row.VALUE_HELP_REQUIRED === "TRUE" || row.VALUE_HELP_REQUIRED === 1
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
                ("SCHEMA_NAME", "TABLE_NAME", "COLUMN_NAME", "SEMANTIC_TYPE", "REFERENCE_TABLE", "REFERENCE_COLUMN", "VALUE_HELP_REQUIRED", "UPDATED_AT")
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_UTCTIMESTAMP)`,
            [
                schemaName,
                tableName,
                field.name,
                metadata.semanticType || null,
                metadata.referenceTable || null,
                metadata.referenceColumn || null,
                metadata.valueHelpRequired
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
        [schemaName, tableName, schemaName, tableName]
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

    return columns.length ? [columns[0].name] : [];
}

async function getTableDefinition(db, schemaName, tableName) {
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
        columns: columns.map((column) => ({
            ...column,
            ...resolveColumnValueHelp(column, fieldMetadata.get(column.name), schemaValueHelpMap, schemaValueHelpAliases),
            key: keyColumns.includes(column.name),
            editable: !keyColumns.includes(column.name)
        }))
    };
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
    for (const field of fields || []) {
        const metadata = getFieldMetadataPayload(field);
        const wantsValueHelp = hasFieldMetadataPayload(field);

        field.semanticType = metadata.semanticType;
        field.referenceTable = metadata.referenceTable;
        field.referenceColumn = metadata.referenceColumn;
        field.valueHelpRequired = metadata.valueHelpRequired;

        if (!wantsValueHelp) {
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
    for (const column of definition.columns || []) {
        if (!column.valueHelpRequired || !column.referenceTable || !column.referenceColumn) {
            continue;
        }

        if (!Object.prototype.hasOwnProperty.call(payload, column.name) || isBlankValue(payload[column.name])) {
            continue;
        }

        const rows = await executeQuery(
            db,
            `SELECT ${quoteIdentifier(column.referenceColumn)} AS "VALUE"
               FROM ${quoteIdentifier(definition.schemaName)}.${quoteIdentifier(column.referenceTable)}
              WHERE ${quoteIdentifier(column.referenceColumn)} = ?
              LIMIT 1`,
            [payload[column.name]]
        );

        if (!rows.length) {
            throw new Error(`Value "${payload[column.name]}" is not valid for ${column.name}. Use the available value help.`);
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

    await validateValueHelpValues(db, definition, row);

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

    if (idColumn && isBlankValue(beforeRow && beforeRow[idColumn.name])) {
        payload[idColumn.name] = cds.utils.uuid();
    }

    if (modifiedAtColumn) {
        payload[modifiedAtColumn.name] = now;
    }

    if (modifiedByColumn) {
        payload[modifiedByColumn.name] = user;
    }

    await validateValueHelpValues(db, definition, payload);

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
                const tables = await getTables(db, schemaName);

                res.json({
                    schemaName,
                    tables
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
            const { tableName, tableType, tableComment, fields, includeCuid, includeManaged, includeTemporal, includeCodeList } = req.body;
            if (!tableName || ((!fields || !fields.length) && !includeCuid && !includeManaged && !includeTemporal && !includeCodeList)) {
                return res.status(400).json({ error: "Missing tableName or fields" });
            }

            const processedFields = [...(fields || [])];

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
            });

            res.json({ success: true, message: "Table created successfully" });
        } catch (err) {
            console.error("Error creating table:", err);
            res.status(500).json({ error: err.message || "Failed to create table" });
        }
    });

    app.delete("/api/schema-browser/tables/:tableName", async (req, res) => {
        try {
            const { tableName } = req.params;
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const sql = `DROP TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
                await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                await deleteFieldMetadata(db, schemaName, tableName);
            });
            res.json({ success: true, message: "Table dropped successfully" });
        } catch (err) {
            console.error("Error dropping table:", err);
            res.status(500).json({ error: err.message || "Failed to drop table" });
        }
    });

    app.patch("/api/schema-browser/tables/:tableName", async (req, res) => {
        try {
            const { tableName } = req.params;
            const { fields } = req.body;
            
            if (!fields || !fields.length) {
                return res.status(400).json({ error: "Missing fields" });
            }

            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);

                await validateFieldMetadataConfiguration(db, schemaName, fields);
                
                const currentColsSql = `
                    SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE
                    FROM SYS.TABLE_COLUMNS
                    WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?
                    UNION ALL
                    SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE
                    FROM SYS.VIEW_COLUMNS
                    WHERE SCHEMA_NAME = ? AND VIEW_NAME = ?
                `;
                const currentCols = await executeQuery(db, currentColsSql, [schemaName, tableName, schemaName, tableName]);
                
                const currentColMap = new Map();
                currentCols.forEach(c => currentColMap.set(c.COLUMN_NAME, c));
                
                const reqColMap = new Map();
                fields.forEach(f => reqColMap.set(f.name, f));
                
                // Add or Alter
                for (const f of fields) {
                    let colDef = `${quoteIdentifier(f.name)} ${f.type}`;
                    const typeUpper = String(f.type || "").toUpperCase();
                    if (f.length && ["VARCHAR", "NVARCHAR", "VARBINARY", "DECIMAL"].includes(typeUpper)) {
                        if (typeUpper === "DECIMAL") {
                            colDef += `(${f.length}${f.scale ? ',' + f.scale : ''})`;
                        } else {
                            colDef += `(${f.length})`;
                        }
                    }

                    if (!currentColMap.has(f.name)) {
                        // ADD
                        if (f.defaultValue !== undefined && f.defaultValue !== "") {
                            colDef += ` DEFAULT '${String(f.defaultValue).replace(/'/g, "''")}'`;
                        }
                        if (f.isNotNull) colDef += " NOT NULL";
                        
                        const sql = `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ADD (${colDef})`;
                        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                    } else {
                        // ALTER (only if type or length changed to avoid HANA errors)
                        const curr = currentColMap.get(f.name);
                        const currType = String(curr.DATA_TYPE_NAME || "").toUpperCase();
                        if (typeUpper !== currType || f.length != curr.LENGTH || f.scale != curr.SCALE) {
                            const sql = `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ALTER (${colDef})`;
                            await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                        }
                    }
                    
                    // Comments
                    if (f.comment) {
                        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [`COMMENT ON COLUMN ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}.${quoteIdentifier(f.name)} IS '${String(f.comment).replace(/'/g, "''")}'`]);
                    }
                }
                
                // Drop
                for (const curr of currentCols) {
                    if (!reqColMap.has(curr.COLUMN_NAME)) {
                        const sql = `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} DROP (${quoteIdentifier(curr.COLUMN_NAME)})`;
                        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                    }
                }

                await replaceFieldMetadata(db, schemaName, tableName, fields);
                await upsertSchemaValueHelpConfig(db, schemaName, fields);
                await upsertSchemaValueHelpAliases(db, schemaName, fields);
            });

            res.json({ success: true, message: "Table altered successfully" });
        } catch (err) {
            console.error("Error altering table:", err);
            res.status(500).json({ error: err.message || "Failed to alter table" });
        }
    });

    app.get("/api/schema-browser/tables/:table/metadata", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
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
                       FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(column.referenceTable)}
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
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
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
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
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
            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
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
            const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
            const changes = req.body.data || {};

            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
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
            const rows = Array.isArray(req.body.rows) ? req.body.rows : [];

            await withDbClient(async (db) => {
                const requestedSchema = req.query.schemaName || req.body.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
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
});

module.exports = cds.service.impl(function () {
    const { PlantLocation, TankVolumes } = this.entities;

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
            const { tableName, tableType, tableComment, fields, includeCuid, includeManaged, includeTemporal, includeCodeList } = req.data;
            if (!tableName || ((!fields || !fields.length) && !includeCuid && !includeManaged && !includeTemporal && !includeCodeList)) {
                return req.reject(400, "Missing tableName or fields");
            }

            const processedFields = [...(fields || [])];

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
            });

            return { success: true, message: "Table created successfully" };
        } catch (err) {
            console.error("Error creating table via OData:", err);
            req.reject(500, err.message || "Failed to create table");
        }
    });

    this.on('dropTable', async (req) => {
        try {
            const { tableName } = req.data;
            if (!tableName) return req.reject(400, "Missing tableName");

            await withDbClient(async (db) => {
                const requestedSchema = req.data.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                const sql = `DROP TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
                await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
            });
            return { success: true, message: "Table dropped successfully" };
        } catch (err) {
            console.error("Error dropping table via OData:", err);
            req.reject(500, err.message || "Failed to drop table");
        }
    });

    this.on('alterTable', async (req) => {
        try {
            const { tableName, fields } = req.data;
            
            if (!tableName || !fields || !fields.length) {
                return req.reject(400, "Missing tableName or fields");
            }

            await withDbClient(async (db) => {
                const requestedSchema = req.data.schemaName;
                const schemaName = requestedSchema || await getCurrentSchema(db);
                
                const currentColsSql = `
                    SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE
                    FROM SYS.TABLE_COLUMNS
                    WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?
                    UNION ALL
                    SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE
                    FROM SYS.VIEW_COLUMNS
                    WHERE SCHEMA_NAME = ? AND VIEW_NAME = ?
                `;
                const currentCols = await executeQuery(db, currentColsSql, [schemaName, tableName, schemaName, tableName]);
                
                const currentColMap = new Map();
                currentCols.forEach(c => currentColMap.set(c.COLUMN_NAME, c));
                
                const reqColMap = new Map();
                fields.forEach(f => reqColMap.set(f.name, f));
                
                // Add or Alter
                for (const f of fields) {
                    let colDef = `${quoteIdentifier(f.name)} ${f.type}`;
                    const typeUpper = String(f.type || "").toUpperCase();
                    if (f.length && ["VARCHAR", "NVARCHAR", "VARBINARY", "DECIMAL"].includes(typeUpper)) {
                        if (typeUpper === "DECIMAL") {
                            colDef += `(${f.length}${f.scale ? ',' + f.scale : ''})`;
                        } else {
                            colDef += `(${f.length})`;
                        }
                    }

                    if (!currentColMap.has(f.name)) {
                        // ADD
                        if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== "") {
                            colDef += ` DEFAULT '${String(f.defaultValue).replace(/'/g, "''")}'`;
                        }
                        if (f.isNotNull) colDef += " NOT NULL";
                        
                        const sql = `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ADD (${colDef})`;
                        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                    } else {
                        // ALTER (only if type or length changed to avoid HANA errors)
                        const curr = currentColMap.get(f.name);
                        const currType = String(curr.DATA_TYPE_NAME || "").toUpperCase();
                        if (typeUpper !== currType || f.length != curr.LENGTH || f.scale != curr.SCALE) {
                            const sql = `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} ALTER (${colDef})`;
                            await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                        }
                    }
                    
                    // Comments
                    if (f.comment) {
                        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [`COMMENT ON COLUMN ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}.${quoteIdentifier(f.name)} IS '${String(f.comment).replace(/'/g, "''")}'`]);
                    }
                }
                
                // Drop
                for (const curr of currentCols) {
                    if (!reqColMap.has(curr.COLUMN_NAME)) {
                        const sql = `ALTER TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} DROP (${quoteIdentifier(curr.COLUMN_NAME)})`;
                        await executeStatement(db, `CALL "EXECUTE_DDL"(?)`, [sql]);
                    }
                }
            });

            return { success: true, message: "Table altered successfully" };
        } catch (err) {
            console.error("Error altering table via OData:", err);
            req.reject(500, err.message || "Failed to alter table");
        }
    });
});
