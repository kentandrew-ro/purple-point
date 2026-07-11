const APPOINTMENT_TYPES = Object.freeze([
  "consultation",
  "cleaning",
  "filling",
  "extraction",
  "other",
]);
const APPOINTMENT_STATUSES = Object.freeze([
  "scheduled",
  "completed",
  "cancelled",
]);
const BILLING_STATUSES = Object.freeze(["unpaid", "partial", "paid"]);
const PAYMENT_METHODS = Object.freeze([
  "cash",
  "card",
  "gcash",
  "bank_transfer",
  "other",
]);
const PAYMENT_STATUSES = Object.freeze(["pending", "completed", "failed"]);

function validateGender(gender) {
  const normalized = String(gender || "").toLowerCase();
  return ["male", "female"].includes(normalized) ? normalized : null;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function amountsEqual(first, second) {
  return Math.abs(Number(first) - Number(second)) < 0.005;
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveBillingStatus(totalAmount, completedAmount, manualStatus) {
  return amountsEqual(totalAmount, completedAmount) ? "paid" : manualStatus;
}

function calculatePaymentOutcome({
  currentCompletedAmount,
  paymentAmount,
  paymentStatus,
  totalAmount,
  manualBillingStatus,
}) {
  const completedAmount =
    Number(currentCompletedAmount) +
    (paymentStatus === "completed" ? Number(paymentAmount) : 0);
  const numericTotal = Number(totalAmount);

  return {
    completedAmount,
    balance: Math.max(numericTotal - completedAmount, 0),
    exceedsTotal: completedAmount - numericTotal > 0.005,
    billingStatus: resolveBillingStatus(
      numericTotal,
      completedAmount,
      manualBillingStatus,
    ),
  };
}

function getDoctorProfileValidationError({
  dateOfBirth,
  hireDate,
  specialization,
  licenseNumber,
}) {
  if (!isIsoDate(dateOfBirth) || !isIsoDate(hireDate)) {
    return "Date of birth and hire date must be valid dates.";
  }
  if (String(specialization || "").length > 100) {
    return "Specialization must not exceed 100 characters.";
  }
  if (String(licenseNumber || "").length > 50) {
    return "License number must not exceed 50 characters.";
  }
  return null;
}

module.exports = {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  BILLING_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  amountsEqual,
  calculatePaymentOutcome,
  getDoctorProfileValidationError,
  isIsoDate,
  parsePositiveInteger,
  resolveBillingStatus,
  validateGender,
};
