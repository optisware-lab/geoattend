const pool = require('../config/database');

async function logAudit({ institutionId, action, entityType, entityId, details, performedBy, ipAddress }) {
  try {
    await pool.withSystemContext((client) =>
      client.query(
        `INSERT INTO audit_logs (institution_id, action, entity_type, entity_id, details, performed_by, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [institutionId, action, entityType, entityId || null, details ? JSON.stringify(details) : null, performedBy, ipAddress || null]
      )
    );
  } catch (err) {
    console.error('Audit log error:', err.message);
  }
}

// Express middleware that wraps route handlers to auto-log admin mutations
function auditMiddleware(action, entityType) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = function (data) {
      // Only log successful mutations (2xx status)
      if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
        const entityId = req.params.id || data?.id || null;
        logAudit({
          institutionId: req.user.institution_id,
          action,
          entityType,
          entityId,
          details: {
            method: req.method,
            path: req.originalUrl,
            body: sanitizeBody(req.body),
          },
          performedBy: req.user.id,
          ipAddress: req.ip,
        });
      }
      return originalJson(data);
    };
    next();
  };
}

function sanitizeBody(body) {
  if (!body) return null;
  const sanitized = { ...body };
  // Remove sensitive fields
  delete sanitized.password;
  delete sanitized.newPassword;
  delete sanitized.passwordHash;
  delete sanitized.token;
  return sanitized;
}

module.exports = { logAudit, auditMiddleware };
