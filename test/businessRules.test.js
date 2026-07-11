const test = require("node:test");
const assert = require("node:assert/strict");

const {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  amountsEqual,
  calculatePaymentOutcome,
  getDoctorProfileValidationError,
  isIsoDate,
  parsePositiveInteger,
  resolveBillingStatus,
  validateGender,
} = require("../lib/businessRules");

test("appointment rules accept only supported types and statuses", () => {
  assert.deepEqual(APPOINTMENT_STATUSES, [
    "scheduled",
    "completed",
    "cancelled",
  ]);
  assert.equal(APPOINTMENT_STATUSES.includes("confirmed"), false);
  assert.equal(APPOINTMENT_STATUSES.includes("pending"), false);
  assert.deepEqual(APPOINTMENT_TYPES, [
    "consultation",
    "cleaning",
    "filling",
    "extraction",
    "other",
  ]);
});

test("doctor selection requires a positive whole-number ID", () => {
  assert.equal(parsePositiveInteger("12"), 12);
  assert.equal(parsePositiveInteger(""), null);
  assert.equal(parsePositiveInteger("1abc"), null);
  assert.equal(parsePositiveInteger(0), null);
  assert.equal(parsePositiveInteger(-1), null);
  assert.equal(parsePositiveInteger(1.5), null);
});

test("ISO date validation handles real calendar dates", () => {
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2025-02-29"), false);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("07/11/2026"), false);
});

test("billing status is forced to paid only when the balance is zero", () => {
  assert.equal(resolveBillingStatus(1000, 1000, "partial"), "paid");
  assert.equal(resolveBillingStatus(1000, 400, "partial"), "partial");
  assert.equal(resolveBillingStatus(1000, 0, "unpaid"), "unpaid");
  assert.equal(amountsEqual("1000.00", "999.999"), true);
});

test("completed payments affect balances while pending and failed do not", () => {
  const completed = calculatePaymentOutcome({
    currentCompletedAmount: 250,
    paymentAmount: 750,
    paymentStatus: "completed",
    totalAmount: 1000,
    manualBillingStatus: "partial",
  });
  assert.deepEqual(completed, {
    completedAmount: 1000,
    balance: 0,
    exceedsTotal: false,
    billingStatus: "paid",
  });

  for (const paymentStatus of ["pending", "failed"]) {
    const outcome = calculatePaymentOutcome({
      currentCompletedAmount: 250,
      paymentAmount: 750,
      paymentStatus,
      totalAmount: 1000,
      manualBillingStatus: "partial",
    });
    assert.equal(outcome.completedAmount, 250);
    assert.equal(outcome.balance, 750);
    assert.equal(outcome.billingStatus, "partial");
  }
});

test("a completed payment that exceeds the balance is rejected by the rule", () => {
  const outcome = calculatePaymentOutcome({
    currentCompletedAmount: 800,
    paymentAmount: 250,
    paymentStatus: "completed",
    totalAmount: 1000,
    manualBillingStatus: "partial",
  });
  assert.equal(outcome.exceedsTotal, true);
});

test("doctor profiles preserve text licenses and enforce field limits", () => {
  assert.equal(validateGender("Female"), "female");
  assert.equal(validateGender("unknown"), null);
  assert.equal(
    getDoctorProfileValidationError({
      dateOfBirth: "1990-05-10",
      hireDate: "2026-07-11",
      specialization: "Oral and Maxillofacial Surgery",
      licenseNumber: "PRC-001-A",
    }),
    null,
  );
  assert.match(
    getDoctorProfileValidationError({
      dateOfBirth: "1990-05-10",
      hireDate: "not-a-date",
      specialization: "General Dentistry",
      licenseNumber: "PRC-001-A",
    }),
    /valid dates/,
  );
  assert.match(
    getDoctorProfileValidationError({
      dateOfBirth: "1990-05-10",
      hireDate: "2026-07-11",
      specialization: "x".repeat(101),
      licenseNumber: "PRC-001-A",
    }),
    /100 characters/,
  );
  assert.match(
    getDoctorProfileValidationError({
      dateOfBirth: "1990-05-10",
      hireDate: "2026-07-11",
      specialization: "General Dentistry",
      licenseNumber: "x".repeat(51),
    }),
    /50 characters/,
  );
});
