require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");
const session = require("express-session");
const { INTERNAL_ERROR_MESSAGE } = require("./lib/http");
const { registerAuthProfileRoutes } = require("./routes/authProfiles");
const { registerAppointmentRoutes } = require("./routes/appointments");
const { registerBillingAuditRoutes } = require("./routes/billingAudit");
const { registerDentalAdminRoutes } = require("./routes/dentalAdmin");
const { registerPageRoutes } = require("./routes/pages");
const { registerReportRoutes } = require("./routes/reports");

const app = express();
const PORT = process.env.PORT;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const SESSION_COOKIE_NAME = "purplepoint.sid";
const configuredSessionSecret = process.env.SESSION_SECRET?.trim();

if (configuredSessionSecret && configuredSessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}
if (IS_PRODUCTION && !configuredSessionSecret) {
  throw new Error("SESSION_SECRET is required in production.");
}

const sessionSecret =
  configuredSessionSecret || crypto.randomBytes(32).toString("hex");
if (!configuredSessionSecret) {
  console.warn(
    "SESSION_SECRET is not set; using a temporary development secret. Sessions will reset when the server restarts.",
  );
}

app.disable("x-powered-by");
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
if (IS_PRODUCTION) app.set("trust proxy", 1);
app.use(
  session({
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: IS_PRODUCTION,
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

registerAuthProfileRoutes(app, {
  sessionCookieName: SESSION_COOKIE_NAME,
  isProduction: IS_PRODUCTION,
});
registerAppointmentRoutes(app);
registerBillingAuditRoutes(app);
registerDentalAdminRoutes(app);
registerReportRoutes(app);
registerPageRoutes(app);

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
});

function startServer() {
  return app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

if (require.main === module) startServer();

module.exports = { app, startServer };
