"use strict";

const path = require("path");
const { MANAGEMENT_ROLES, normalizeRole } = require("../lib/http");
const ROOT_DIR = path.join(__dirname, "..");

function isManagementUser(req) {
  return MANAGEMENT_ROLES.includes(normalizeRole(req.session.role));
}

function registerPageRoutes(app) {
  app.get("/", (req, res) => {
    res.redirect("/login.html");
  });
  app.get("/patientPage.html", (req, res) => {
    if (!req.session.userId) return res.redirect("/login.html");
    if (normalizeRole(req.session.role) !== "patient")
      return res.redirect("/adminPage.html");
    res.sendFile(
      path.join(ROOT_DIR, "protected", "patient", "patientPage.html"),
    );
  });

  app.get("/js/patientPage.js", (req, res) => {
    if (!req.session.userId) return res.status(401).send("Unauthorized");
    res.sendFile(path.join(ROOT_DIR, "protected", "js", "patientPage.js"));
  });

  app.get("/adminPage.html", (req, res) => {
    if (!req.session.userId) return res.redirect("/login.html");
    if (!isManagementUser(req)) return res.redirect("/patientPage.html");
    res.sendFile(path.join(ROOT_DIR, "protected", "admin", "adminPage.html"));
  });

  app.get("/profile.html", (req, res) => {
    if (!req.session.userId) return res.redirect("/login.html");
    if (normalizeRole(req.session.role) !== "patient")
      return res.redirect("/adminPage.html");
    res.sendFile(path.join(ROOT_DIR, "protected", "patient", "profile.html"));
  });

  app.get("/appointments.html", (req, res) => {
    if (!req.session.userId) return res.redirect("/login.html");
    if (normalizeRole(req.session.role) !== "patient")
      return res.redirect("/adminPage.html");
    res.sendFile(
      path.join(ROOT_DIR, "protected", "patient", "appointments.html"),
    );
  });

  app.get("/js/profile.js", (req, res) => {
    if (!req.session.userId) return res.status(401).send("Unauthorized");
    res.sendFile(path.join(ROOT_DIR, "protected", "js", "profile.js"));
  });

  app.get("/js/appointments.js", (req, res) => {
    if (!req.session.userId) return res.status(401).send("Unauthorized");
    res.sendFile(path.join(ROOT_DIR, "protected", "js", "appointments.js"));
  });

  app.get("/js/adminPage.js", (req, res) => {
    if (!req.session.userId) return res.status(401).send("Unauthorized");
    if (!isManagementUser(req)) return res.status(403).send("Forbidden");
    res.sendFile(path.join(ROOT_DIR, "protected", "js", "adminPage.js"));
  });
}

module.exports = { registerPageRoutes };
