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
  "no_show",
]);
const DOCTOR_SPECIALIZATION_KEYWORDS = Object.freeze({
  consultation: Object.freeze(["general", "family", "consult", "diagnostic"]),
  cleaning: Object.freeze([
    "general",
    "family",
    "prevent",
    "periodont",
    "hygien",
  ]),
  filling: Object.freeze([
    "general",
    "family",
    "restor",
    "operative",
    "prosthodont",
  ]),
  extraction: Object.freeze([
    "general",
    "family",
    "oral surg",
    "maxillofacial",
    "extraction",
  ]),
  other: Object.freeze([]),
});
const BILLING_STATUSES = Object.freeze(["unpaid", "partial", "paid"]);
const PAYMENT_METHODS = Object.freeze([
  "cash",
  "card",
  "gcash",
  "e_wallet",
  "bank_transfer",
  "other",
]);
const PAYMENT_STATUSES = Object.freeze(["pending", "completed", "failed"]);

function isValidEmail(email) {
  const normalized = String(email || "").trim();
  return (
    normalized.length <= 100 &&
    /^[^\s@]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(
      normalized,
    )
  );
}

function getPasswordValidationError(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Password must contain at least 8 characters.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter.";
  }
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    return "Password must contain at least one special character.";
  }
  return null;
}

function validateGender(gender) {
  const normalized = String(gender || "").toLowerCase();
  return ["male", "female"].includes(normalized) ? normalized : null;
}

function doctorMatchesAppointmentType(appointmentType, specialization) {
  const normalizedType = String(appointmentType || "").toLowerCase();
  if (!APPOINTMENT_TYPES.includes(normalizedType)) return false;
  const keywords = DOCTOR_SPECIALIZATION_KEYWORDS[normalizedType];
  if (!keywords.length) return true;
  const normalizedSpecialization = String(specialization || "").toLowerCase();
  return keywords.some((keyword) => normalizedSpecialization.includes(keyword));
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
  doctorMatchesAppointmentType,
  getPasswordValidationError,
  getDoctorProfileValidationError,
  isValidEmail,
  isIsoDate,
  parsePositiveInteger,
  resolveBillingStatus,
  validateGender,
};
