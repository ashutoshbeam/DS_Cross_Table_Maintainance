const cds = require("@sap/cds");
const express = require("express");

const ROW_LIMIT = 200;
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

async function getTables(db, schemaName) {
    const rows = await executeQuery(db,
        `SELECT TABLE_NAME
           FROM SYS.TABLES
          WHERE SCHEMA_NAME = ?
          ORDER BY TABLE_NAME`,
        [schemaName]
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
          ORDER BY POSITION`,
        [schemaName, tableName]
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

    return {
        schemaName,
        tableName,
        keyColumns,
        columns: columns.map((column) => ({
            ...column,
            key: keyColumns.includes(column.name),
            editable: !keyColumns.includes(column.name)
        }))
    };
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

    app.get("/api/schema-browser/tables", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const schemaName = await getCurrentSchema(db);
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

    app.get("/api/schema-browser/tables/:table/metadata", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const schemaName = await getCurrentSchema(db);
                const definition = await getTableDefinition(db, schemaName, req.params.table);

                res.json(definition);
            });
        } catch (error) {
            console.error("schema-browser/metadata failed:", error);
            res.status(400).json({ error: error.message });
        }
    });

    app.get("/api/schema-browser/tables/:table/rows", async (req, res) => {
        try {
            await withDbClient(async (db) => {
                const schemaName = await getCurrentSchema(db);
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
                const schemaName = await getCurrentSchema(db);
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
                const schemaName = await getCurrentSchema(db);
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
                const schemaName = await getCurrentSchema(db);
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
                const schemaName = await getCurrentSchema(db);
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
                const schemaName = await getCurrentSchema(db);
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
});
