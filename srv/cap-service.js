const cds = require("@sap/cds");
const express = require("express");

const ROW_LIMIT = 200;
let dbPromise;

const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;

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
        return allowNull && column.nullable ? null : value;
    }

    return value;
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

async function insertRow(db, definition, payload) {
    const validColumns = definition.columns
        .filter((column) => payload[column.name] !== undefined)
        .map((column) => ({
            ...column,
            value: normalizeValue(column, payload[column.name])
        }))
        .filter((column) => column.value !== undefined);

    if (!validColumns.length) {
        throw new Error("No values provided to create a row.");
    }

    const sql = `INSERT INTO ${quoteIdentifier(definition.schemaName)}.${quoteIdentifier(definition.tableName)}
        (${validColumns.map((column) => quoteIdentifier(column.name)).join(", ")})
        VALUES (${validColumns.map(() => "?").join(", ")})`;

    await executeStatement(db, sql, validColumns.map((column) => column.value));
}

async function updateRow(db, definition, keys, changes) {
    const editableColumns = definition.columns
        .filter((column) => !column.key && changes[column.name] !== undefined)
        .map((column) => ({
            ...column,
            value: normalizeValue(column, changes[column.name])
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
}

async function deleteRow(db, definition, keys) {
    const where = buildWhereClause(keys, definition.keyColumns, definition.columns);
    const sql = `DELETE FROM ${quoteIdentifier(definition.schemaName)}.${quoteIdentifier(definition.tableName)}
        WHERE ${where.clause}`;

    await executeStatement(db, sql, where.values);
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
                await insertRow(db, definition, req.body.data || {});
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
                await updateRow(db, definition, req.body.keys || {}, req.body.data || {});
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
                await deleteRow(db, definition, req.body.keys || {});
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
                    await updateRow(db, definition, keys, changes);
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
                    await insertRow(db, definition, row);
                }
            });

            res.json({ success: true, count: rows.length });
        } catch (error) {
            console.error("schema-browser/mass-upload failed:", error);
            res.status(400).json({ error: error.message });
        }
    });
});

module.exports = cds.service.impl(async function () {
    // Service entities remain available through OData.
});
