"use strict";

const path = require("path");
const ROOT_DIR = path.join(__dirname, "..");

function registerPageRoutes(app) {
  app.get("/", (req, res) => {
    res.redirect("/login.html");
  });
  app.get("/patientPage.html", (req, res) => {
    if (!req.session.userId) return res.redirect("/login.html");
    if (req.session.role !== "patient") return res.redirect("/adminPage.html");
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
    if (req.session.role !== "admin") return res.redirect("/patientPage.html");
    res.sendFile(path.join(ROOT_DIR, "protected", "admin", "adminPage.html"));
  });

  app.get("/profile.html", (req, res) => {
    if (!req.session.userId) return res.redirect("/login.html");
    if (req.session.role !== "patient") return res.redirect("/adminPage.html");
    res.sendFile(path.join(ROOT_DIR, "protected", "patient", "profile.html"));
  });

  app.get("/appointments.html", (req, res) => {
    if (!req.session.userId) return res.redirect("/login.html");
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
    if (req.session.role !== "admin") return res.status(403).send("Forbidden");
    res.sendFile(path.join(ROOT_DIR, "protected", "js", "adminPage.js"));
  });
}

module.exports = { registerPageRoutes };
