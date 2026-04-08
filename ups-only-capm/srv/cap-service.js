const cds = require("@sap/cds");
const hdb = require("hdb");

const UPS_SERVICE_NAME = process.env.UPS_SERVICE_NAME || "DS_INTEGRATION";
const UPS_TARGET_TABLE = process.env.UPS_TARGET_TABLE || "ZPLANT_LOCATION";
const UPS_TARGET_SCHEMA = process.env.UPS_TARGET_SCHEMA;
const ALLOWED_COLUMNS = ["PLANT", "COMPANY_CODE", "LOCATION", "LOCATION_TYPE", "REGION"];

module.exports = cds.service.impl(function () {
  const { PlantLocation } = this.entities;

  this.on("READ", PlantLocation, async (req) => {
    const where = toWhereClause(req.query?.SELECT?.where || []);
    const orderBy = toOrderByClause(req.query?.SELECT?.orderBy || []);
    const limit = toLimitClause(req.query?.SELECT?.limit);
    const sql = [
      `SELECT ${ALLOWED_COLUMNS.join(", ")} FROM ${getQualifiedTableName(req)}`,
      where.sql,
      orderBy,
      limit.sql
    ].filter(Boolean).join(" ");
    const rows = await executeQuery(req, sql, [...where.values, ...limit.values]);

    if (req.query?.SELECT?.count) {
      const countRows = await executeQuery(
        req,
        [
          `SELECT COUNT(*) AS TOTAL FROM ${getQualifiedTableName(req)}`,
          where.sql
        ].filter(Boolean).join(" "),
        where.values
      );
      rows.$count = countRows[0] ? countRows[0].TOTAL : 0;
    }

    if (req.data && req.data.PLANT && !req.query?.SELECT?.limit) {
      return rows[0] || null;
    }

    return rows;
  });

  this.on("CREATE", PlantLocation, async (req) => {
    const entry = normalizeEntry(req.data, true);
    const sql = `INSERT INTO ${getQualifiedTableName(req)} (${ALLOWED_COLUMNS.join(", ")}) VALUES (${ALLOWED_COLUMNS.map(() => "?").join(", ")})`;

    await executeStatement(req, sql, ALLOWED_COLUMNS.map((column) => entry[column]));
    return entry;
  });

  this.on("UPDATE", PlantLocation, async (req) => {
    const key = req.data.PLANT || req.params?.[0]?.PLANT;
    const payload = normalizeEntry({ ...req.data, PLANT: key }, false);
    const setColumns = ALLOWED_COLUMNS.filter((column) => column !== "PLANT" && payload[column] !== undefined);

    if (!key) {
      req.reject(400, "PLANT key is required for update.");
    }
    if (!setColumns.length) {
      return readSingle(req, key);
    }

    await executeStatement(
      req,
      `UPDATE ${getQualifiedTableName(req)} SET ${setColumns.map((column) => `${column} = ?`).join(", ")} WHERE PLANT = ?`,
      [...setColumns.map((column) => payload[column]), key]
    );

    return readSingle(req, key);
  });

  this.on("DELETE", PlantLocation, async (req) => {
    const key = req.data.PLANT || req.params?.[0]?.PLANT;

    if (!key) {
      req.reject(400, "PLANT key is required for delete.");
    }

    await executeStatement(req, `DELETE FROM ${getQualifiedTableName(req)} WHERE PLANT = ?`, [key]);
    return req.data;
  });
});

async function readSingle(req, plant) {
  const rows = await executeQuery(
    req,
    `SELECT ${ALLOWED_COLUMNS.join(", ")} FROM ${getQualifiedTableName(req)} WHERE PLANT = ?`,
    [plant]
  );

  return rows[0] || null;
}

function normalizeEntry(data, requireKey) {
  const entry = {};

  ALLOWED_COLUMNS.forEach((column) => {
    if (Object.prototype.hasOwnProperty.call(data, column)) {
      entry[column] = data[column] == null ? "" : String(data[column]).trim();
    }
  });

  if (requireKey && !entry.PLANT) {
    throw new cds.error("PLANT is required.", { status: 400 });
  }
  if (!entry.COMPANY_CODE) {
    throw new cds.error("COMPANY_CODE is required.", { status: 400 });
  }
  if (!entry.LOCATION) {
    throw new cds.error("LOCATION is required.", { status: 400 });
  }

  return entry;
}

function toWhereClause(tokens) {
  if (!tokens || !tokens.length) {
    return { sql: "", values: [] };
  }

  let index = 0;

  function parseExpression() {
    let left = parseTerm();

    while (index < tokens.length && isOperator(tokens[index], "or")) {
      index += 1;
      left = combine(left, "OR", parseTerm());
    }

    return left;
  }

  function parseTerm() {
    let left = parseFactor();

    while (index < tokens.length && isOperator(tokens[index], "and")) {
      index += 1;
      left = combine(left, "AND", parseFactor());
    }

    return left;
  }

  function parseFactor() {
    const token = tokens[index];

    if (token?.func) {
      index += 1;
      return parseFunction(token);
    }

    if (tokens[index] === "(") {
      index += 1;
      const expression = parseExpression();

      if (tokens[index] === ")") {
        index += 1;
      }

      return {
        sql: `(${expression.sql})`,
        values: expression.values
      };
    }

    return parseComparison();
  }

  function parseFunction(token) {
    const name = token.func.toLowerCase();
    const column = toColumn(token.args?.[0]);
    const value = toValue(token.args?.[1]);

    if (!column) {
      throw new cds.error("Unsupported filter function column.", { status: 400 });
    }
    if (name === "contains") {
      return { sql: `${column} LIKE ?`, values: [`%${value}%`] };
    }
    if (name === "startswith") {
      return { sql: `${column} LIKE ?`, values: [`${value}%`] };
    }
    if (name === "endswith") {
      return { sql: `${column} LIKE ?`, values: [`%${value}`] };
    }

    throw new cds.error(`Unsupported filter function: ${token.func}.`, { status: 400 });
  }

  function parseComparison() {
    const left = tokens[index];
    const operator = tokens[index + 1];
    const right = tokens[index + 2];
    const column = toColumn(left);

    index += 3;

    if (!column) {
      throw new cds.error("Unsupported filter column.", { status: 400 });
    }
    if (isOperator(operator, "=") || isOperator(operator, "eq")) {
      return { sql: `${column} = ?`, values: [toValue(right)] };
    }
    if (isOperator(operator, "!=") || isOperator(operator, "<>") || isOperator(operator, "ne")) {
      return { sql: `${column} <> ?`, values: [toValue(right)] };
    }
    if (isOperator(operator, "like")) {
      return { sql: `${column} LIKE ?`, values: [toValue(right)] };
    }

    throw new cds.error(`Unsupported filter operator: ${operator}.`, { status: 400 });
  }

  return parseExpression();
}

function combine(left, operator, right) {
  return {
    sql: `(${left.sql} ${operator} ${right.sql})`,
    values: [...left.values, ...right.values]
  };
}

function toOrderByClause(orderBy) {
  if (!orderBy || !orderBy.length) {
    return "ORDER BY PLANT";
  }

  return `ORDER BY ${orderBy.map((item) => {
    const column = toColumn(item);

    if (!column) {
      throw new cds.error("Unsupported sort column.", { status: 400 });
    }

    return `${column} ${item.sort === "desc" ? "DESC" : "ASC"}`;
  }).join(", ")}`;
}

function toLimitClause(limit) {
  const rows = limit?.rows?.val;
  const offset = limit?.offset?.val;
  const values = [];
  let sql = "";

  if (rows !== undefined) {
    sql += " LIMIT ?";
    values.push(rows);
  }
  if (offset !== undefined) {
    sql += " OFFSET ?";
    values.push(offset);
  }

  return { sql, values };
}

function toColumn(token) {
  const ref = token?.ref?.[token.ref.length - 1];
  return ALLOWED_COLUMNS.includes(ref) ? ref : null;
}

function toValue(token) {
  if (Object.prototype.hasOwnProperty.call(token || {}, "val")) {
    return token.val;
  }
  return token;
}

function isOperator(token, expected) {
  return token === expected || token?.toLowerCase?.() === expected;
}

function getQualifiedTableName(req) {
  const credentials = getUpsCredentials(req);
  const schema = UPS_TARGET_SCHEMA || credentials.schema;

  return schema ? `"${schema}"."${UPS_TARGET_TABLE}"` : `"${UPS_TARGET_TABLE}"`;
}

function getUpsCredentials() {
  const raw = process.env.VCAP_SERVICES;
  let services;
  let found;

  if (!raw) {
    throw new Error("VCAP_SERVICES is not available. Bind the DS_INTEGRATION UPS service.");
  }

  services = JSON.parse(raw);
  Object.keys(services).some((label) => {
    found = services[label].find((service) => service.name === UPS_SERVICE_NAME);
    return Boolean(found);
  });

  if (!found) {
    throw new Error(`Service ${UPS_SERVICE_NAME} not found in VCAP_SERVICES.`);
  }

  return found.credentials || found;
}

function executeQuery(req, sql, values) {
  return withClient(req, (client) => runPrepared(client, sql, values));
}

function executeStatement(req, sql, values) {
  return withClient(req, async (client) => {
    await runPrepared(client, sql, values);
  });
}

async function withClient(req, executor) {
  const credentials = getUpsCredentials(req);
  const client = hdb.createClient({
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    password: credentials.password,
    schema: UPS_TARGET_SCHEMA || credentials.schema
  });

  await connect(client);

  try {
    return await executor(client);
  } finally {
    await disconnect(client);
  }
}

function connect(client) {
  return new Promise((resolve, reject) => {
    client.connect((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function disconnect(client) {
  return new Promise((resolve) => {
    client.disconnect(() => resolve());
  });
}

function runPrepared(client, sql, values) {
  return new Promise((resolve, reject) => {
    client.prepare(sql, (prepareError, statement) => {
      if (prepareError) {
        reject(prepareError);
        return;
      }

      statement.exec(values || [], (execError, rows) => {
        if (execError) {
          reject(execError);
          return;
        }
        resolve(rows);
      });
    });
  });
}
