const { Pool } = require('pg');
require('dotenv').config();

let poolConfig;

if (process.env.DATABASE_URL) {
  let connectionString = process.env.DATABASE_URL;
  // Neon's transaction-pooler host does not preserve session state
  // (SET / set_config) across statements — Row-Level Security context would
  // silently evaporate. All app connections must use the direct endpoint.
  try {
    const url = new URL(connectionString);
    if (url.hostname.includes('-pooler')) {
      const previous = url.hostname;
      url.hostname = url.hostname.replace('-pooler', '');
      console.warn(
        `DATABASE_URL points at the transaction pooler (${previous}). RLS session context needs the direct endpoint — rewriting host to ${url.hostname}.`
      );
      connectionString = url.toString();
    }
  } catch (err) {
    // Leave the string untouched if it cannot be parsed
  }
  poolConfig = {
    connectionString,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
} else {
  const sslConfig = process.env.DB_SSL === 'true'
    ? { rejectUnauthorized: false }
    : false;

  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'geofence_attendance',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: sslConfig,
  };
}

// ─── Row-Level Security context helpers ─────────────────────────────────────
//
// Tenant tables protect their rows with policies comparing
// current_setting('app.institution_id') / ('app.bypass_rls').
//
// Two channels exist:
//
// 1) App role channel (default): every pooled connection runs
//    `SET ROLE geoattend_app` right after connecting — a NOLOGIN role created
//    by the migrations that has ordinary SELECT/INSERT/UPDATE/DELETE grants
//    and, crucially, NO BYPASSRLS attribute. (Hosted Neon grants the project
//    owner role rolbypassrls=true, which makes policies inert for it — that is
//    why connections must masquerade as the restricted role.) Inside this
//    channel the system areas (cron, startup, super admin, public auth flows)
//    keep working because the RLS policies themselves look at the
//    app.bypass_rls session flag: onConnect sets it to 'on'.
//
// 2) Owner channel: withOwnerContext is reserved for DDL — RESET ROLE brings
//    back the connecting owner so migrations can ALTER/CREATE tables.
//
// Authenticated requests do real enforcement: middleware/auth.js turns the
// app.bypass_rls flag OFF and sets the exact institution. From then on
// Postgres itself refuses any row of another tenant. When the response is
// done, resetContext puts the connection back into the system channel before
// releasing it.
//
// Policies guard against empty settings with NULLIF(... , '') so a cleared
// institution never errors on the uuid cast.
//
// Statements stay in autocommit mode — no explicit transaction — so a failed
// statement never poisons the rest of the request.

const SYSTEM_CONTEXT_SQL =
  "SELECT set_config('app.bypass_rls', 'on', false), set_config('app.institution_id', '', false)";

const TENANT_CONTEXT_SQL =
  "SELECT set_config('app.bypass_rls', 'off', false), set_config('app.institution_id', $1, false)";

const APP_ROLE = 'geoattend_app';

// pg-pool awaits onConnect before the first acquire of a client — event
// listeners on 'connect' are NOT awaited, so this must stay in the config.
poolConfig.onConnect = (client) => {
  return (async () => {
    await client.query(SYSTEM_CONTEXT_SQL);
    try {
      // Switch into the restricted role so RLS actually applies to this
      // connection (the connecting owner may carry rolbypassrls).
      await client.query(`SET ROLE ${APP_ROLE}`);
    } catch (err) {
      // Fresh databases run their first server boot before the migrations
      // have created the role — fall back to the owner (with a warning) and
      // let the bootstrap create it.
      if (err.code === '42704' || /does not exist/i.test(err.message || '')) {
        console.warn('RLS app role missing — running as owner until migrations create it.');
        return;
      }
      throw err;
    }
  })().catch((err) => {
    console.error('Failed to set default RLS context on connect:', err.message);
    throw err; // fail the connection rather than run it unconfigured
  });
};

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

async function applyTenantContext(client, { institutionId, bypass = false }) {
  if (bypass) {
    // Super admin / system: full cross-tenant access on this request.
    await client.query(SYSTEM_CONTEXT_SQL);
  } else if (institutionId) {
    // Real tenant enforcement: bypass OFF + exact institution.
    await client.query(TENANT_CONTEXT_SQL, [String(institutionId)]);
  } else {
    throw new Error('applyTenantContext requires institutionId when bypass is false');
  }
}

async function resetContext(client) {
  try {
    // Put the connection back into the system channel instead of RESET ALL
    // (RESET ALL would also drop the connect-time default on this session).
    await client.query(SYSTEM_CONTEXT_SQL);
  } catch (err) {
    // Connection is being released anyway; nothing else to do
  }
}

/**
 * Run `fn(client)` on a pooled connection whose role is back to the connecting
 * owner. Reserved for DDL (auto-migrations): the app role created by the RLS
 * setup has no table-ownership rights, so ALTER/CREATE statements must run on
 * the owner channel. Everything else goes through the app role.
 */
async function withOwnerContext(fn) {
  const client = await pool.connect();
  try {
    await client.query(SYSTEM_CONTEXT_SQL);
    // Downgrade to the owner that created the connection. Connections whose
    // onConnect SET ROLE failed (fresh bootstrap) are already the owner.
    await client.query('RESET ROLE');
    return await fn(client);
  } finally {
    await client.query(`SET ROLE ${APP_ROLE}`).catch(() => {});
    await resetContext(client);
    client.release();
  }
}

/**
 * Run `fn(client)` on a pooled connection confirmed to be in the system
 * channel. Used for public auth flows, background jobs and startup tasks.
 */
async function withSystemContext(fn) {
  const client = await pool.connect();
  try {
    await client.query(SYSTEM_CONTEXT_SQL);
    return await fn(client);
  } finally {
    await resetContext(client);
    client.release();
  }
}

pool.applyTenantContext = applyTenantContext;
pool.resetContext = resetContext;
pool.withSystemContext = withSystemContext;
pool.withOwnerContext = withOwnerContext;

module.exports = pool;
