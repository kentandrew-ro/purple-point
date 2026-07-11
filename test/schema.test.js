const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const schema = fs
  .readFileSync(path.join(__dirname, "..", "database.sql"), "utf8")
  .replace(/\s+/g, " ");

test("appointment schema matches the supported status rule", () => {
  assert.match(
    schema,
    /appointment_status ENUM\('scheduled', 'completed', 'cancelled'\) NOT NULL DEFAULT 'scheduled'/,
  );
});

test("doctor schema preserves text licenses and hire dates", () => {
  assert.match(schema, /specialization VARCHAR\(100\) NOT NULL/);
  assert.match(schema, /license_number VARCHAR\(50\) NOT NULL/);
  assert.match(schema, /hire_date DATE/);
  assert.match(
    schema,
    /UNIQUE KEY uq_dentist_license_number \(license_number\)/,
  );
});

test("payment and billing status enums match server rules", () => {
  assert.match(
    schema,
    /billing_status ENUM\('unpaid', 'partial', 'paid'\) NOT NULL DEFAULT 'unpaid'/,
  );
  assert.match(
    schema,
    /payment_status ENUM\('pending', 'completed', 'failed'\) NOT NULL DEFAULT 'completed'/,
  );
});
