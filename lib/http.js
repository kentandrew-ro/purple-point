"use strict";

const INTERNAL_ERROR_MESSAGE = "An internal server error occurred.";
const MANAGEMENT_ROLES = Object.freeze(["superadmin", "doctor", "staff"]);

function requireField(obj, key) {
  const value = obj?.[key];
  if (value === undefined || value === null) return null;
  return String(value).trim();
}

function normalizeRole(role) {
  // Keep existing installations usable until the role migration is applied.
  return role === "admin" ? "superadmin" : role;
}

function hasRole(req, allowedRoles) {
  return allowedRoles.includes(normalizeRole(req.session?.role));
}

function requireRole(req, res, allowedRoles) {
  if (!req.session.userId) {
    res.status(401).json({ ok: false, error: "Not logged in" });
    return false;
  }
  if (!hasRole(req, allowedRoles)) {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  return requireRole(req, res, ["superadmin"]);
}

module.exports = {
  INTERNAL_ERROR_MESSAGE,
  MANAGEMENT_ROLES,
  hasRole,
  normalizeRole,
  requireAdmin,
  requireField,
  requireRole,
};
