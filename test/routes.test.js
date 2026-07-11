const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "test-session-secret-with-at-least-32-characters";

const { app } = require("../server");

test("all public API and protected-page routes remain registered", () => {
  const actualRoutes = app.router.stack
    .filter((layer) => layer.route)
    .map((layer) => {
      const method = Object.keys(layer.route.methods)[0].toUpperCase();
      return `${method} ${layer.route.path}`;
    });

  assert.deepEqual(actualRoutes, [
    "POST /api/signup",
    "POST /api/login",
    "POST /api/logout",
    "GET /api/me",
    "GET /api/patients/me",
    "PUT /api/patients/me",
    "POST /api/patients",
    "POST /api/staff",
    "POST /api/doctors",
    "POST /api/dentist-schedule",
    "GET /api/appointments",
    "POST /api/appointments",
    "POST /api/appointments/:id/cancel",
    "PATCH /api/appointments/:id/status",
    "GET /api/dashboard/stats",
    "GET /api/dashboard/schedule",
    "GET /api/audit-logs",
    "GET /api/audit-logs/:id",
    "GET /api/billings",
    "GET /api/billing/patients/:patientId/treatments",
    "POST /api/billings",
    "GET /api/billings/:id",
    "PATCH /api/billings/:id",
    "POST /api/billings/:id/payments",
    "PATCH /api/payments/:id/status",
    "GET /api/admin/users/search",
    "GET /api/patients/search",
    "GET /api/patients/:id",
    "GET /api/dentists",
    "GET /api/dentists/search",
    "GET /api/appointments/patient/:patientId",
    "GET /api/dental-records/patient/:patientId",
    "PUT /api/dental-records/:id",
    "POST /api/dental-records",
    "POST /api/patient-vitals",
    "PUT /api/tooth-chart",
    "GET /api/admin/users/summary",
    "POST /api/admin/users/promote",
    "GET /",
    "GET /patientPage.html",
    "GET /js/patientPage.js",
    "GET /adminPage.html",
    "GET /profile.html",
    "GET /appointments.html",
    "GET /js/profile.js",
    "GET /js/appointments.js",
    "GET /js/adminPage.js",
  ]);
});
