// A 500 that says where it broke. The reply carries a short reference such as
// "auth-22P02" (step + database/JS error code), never SQL, data or secrets, so
// the app can show it and a screenshot is enough to find the cause in the logs.

function errorRef(stage, err) {
  const code = String(err?.code || err?.name || 'ERR').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
  return `${stage}-${code}`;
}

function sendServerError(res, stage, err, req) {
  const ref = errorRef(stage, err);
  console.error(`[${ref}]`, req?.user?.id ? `user=${req.user.id}` : '', err?.message || err);
  if (!res.headersSent) res.status(500).json({ error: 'Server error', ref });
  return ref;
}

module.exports = { errorRef, sendServerError };
