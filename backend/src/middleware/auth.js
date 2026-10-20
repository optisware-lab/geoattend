const jwt = require('jsonwebtoken');
const pool = require('../config/database');

/**
 * Verifies the JWT, loads the user from the database and binds the request to
 * a pooled connection carrying the Row-Level Security context:
 *  - ordinary staff/admin requests are scoped to their institution
 *    (SET app.institution_id) so every query on a tenant table can only see
 *    that institution's rows — enforced by Postgres policies, not code.
 *  - super_admin requests get the RLS bypass flag (cross-tenant by design).
 *
 * The bound connection is exposed as `req.tenantDb`; controllers must run
 * tenant queries through it. It is reset and released when the response
 * finishes. Statements stay in autocommit mode, so a failed statement never
 * poisons the rest of the request.
 */
const authenticate = async (req, res, next) => {
  // 1) Token verification — no DB access needed
  let decoded;
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }

  // 2) Database stage — bind connection, load user, re-apply context from the row
  let client = null;
  let released = false;
  const releaseClient = () => {
    if (released) return;
    released = true;
    pool.resetContext(client).catch(() => {});
    client.release();
  };

  try {
    client = await pool.connect();

    res.on('finish', releaseClient);
    res.on('close', releaseClient);

    // Seed context from the signed token so the user lookup itself is visible
    // under RLS. Missing/legacy institution ids fall back to bypass; the true
    // context is re-applied from the DB row right after.
    await pool.applyTenantContext(client, {
      institutionId: decoded.institutionId,
      bypass: decoded.role === 'super_admin' || !decoded.institutionId,
    });

    const result = await client.query(
      'SELECT id, institution_id, staff_id, first_name, last_name, email, role, member_type, is_active FROM staff WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Invalid or inactive account' });
    }

    // Staff-only system: legacy student accounts can no longer use the API
    if (result.rows[0].member_type && result.rows[0].member_type !== 'staff') {
      return res.status(401).json({ error: 'Only staff accounts can sign in' });
    }

    // Re-apply the context from the authoritative DB row (role could have been
    // demoted/promoted since the token was signed).
    await pool.applyTenantContext(client, {
      institutionId: result.rows[0].institution_id,
      bypass: result.rows[0].role === 'super_admin',
    });

    req.user = result.rows[0];
    req.tenantDb = client;
    return next();
  } catch (err) {
    if (client) {
      releaseClient();
    }
    console.error('Authenticate error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super admin access required' });
  }
  next();
};

module.exports = { authenticate, requireAdmin, requireSuperAdmin };
