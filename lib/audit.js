"use strict";

const { pool } = require("./database");

async function createAuditLog(executor, req, details) {
  const [actors] = await executor.execute(
    `SELECT
       u.user_id,
       CONCAT(u.first_name, ' ', u.last_name) AS actor_name,
       CASE
         WHEN d.dentist_id IS NOT NULL THEN 'doctor'
         WHEN s.staff_id IS NOT NULL THEN 'staff'
         ELSE u.role
       END AS actor_type
     FROM users u
     LEFT JOIN dentist d ON d.user_id = u.user_id
     LEFT JOIN staff s ON s.user_id = u.user_id
     WHERE u.user_id = ?`,
    [req.session.userId],
  );
  const actor = actors[0] || {};
  const oldValues =
    details.oldValues === undefined || details.oldValues === null
      ? null
      : JSON.stringify(details.oldValues);
  const newValues =
    details.newValues === undefined || details.newValues === null
      ? null
      : JSON.stringify(details.newValues);
  const ipAddress = String(req.ip || req.socket?.remoteAddress || "")
    .replace(/^::ffff:/, "")
    .slice(0, 45);

  await executor.execute(
    `INSERT INTO audit_logs
       (actor_user_id, actor_name_snapshot, actor_type_snapshot, action,
        entity_type, entity_id, description, old_values, new_values, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.session.userId,
      actor.actor_name || `User #${req.session.userId}`,
      actor.actor_type || req.session.role || "unknown",
      details.action,
      details.entityType,
      details.entityId || null,
      details.description,
      oldValues,
      newValues,
      ipAddress || null,
    ],
  );
}

async function recordAudit(req, details) {
  try {
    await createAuditLog(pool, req, details);
  } catch (error) {
    console.error("Unable to record audit log:", error);
  }
}

module.exports = { createAuditLog, recordAudit };
