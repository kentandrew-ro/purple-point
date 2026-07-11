"use strict";

const INTERNAL_ERROR_MESSAGE = "An internal server error occurred.";

function requireField(obj, key) {
  const value = obj?.[key];
  if (value === undefined || value === null) return null;
  return String(value).trim();
}

function requireAdmin(req, res) {
  if (!req.session.userId) {
    res.status(401).json({ ok: false, error: "Not logged in" });
    return false;
  }
  if (req.session.role !== "admin") {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return false;
  }
  return true;
}

module.exports = {
  INTERNAL_ERROR_MESSAGE,
  requireAdmin,
  requireField,
};
