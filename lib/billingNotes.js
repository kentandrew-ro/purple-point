"use strict";

const BILLING_STATUS_LABELS = Object.freeze({
  unpaid: "Unpaid",
  partial: "Partially paid",
  paid: "Fully paid",
});

const PAYMENT_METHOD_DETAILS = Object.freeze({
  cash: Object.freeze({ label: "Cash", channel: "Physical" }),
  card: Object.freeze({ label: "Card", channel: "Physical" }),
  gcash: Object.freeze({ label: "GCash", channel: "E-Wallet" }),
  e_wallet: Object.freeze({ label: "E-Wallet", channel: "E-Wallet" }),
  bank_transfer: Object.freeze({
    label: "Bank transfer",
    channel: "Online",
  }),
  other: Object.freeze({ label: "Other", channel: "Other" }),
});

function parseAuditValues(value) {
  if (!value) return {};
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
}

function getBillingStatusLabel(status) {
  return BILLING_STATUS_LABELS[String(status || "").toLowerCase()] || "Unknown";
}

function getPaymentMethodDetails(method) {
  return (
    PAYMENT_METHOD_DETAILS[String(method || "").toLowerCase()] ||
    Object.freeze({ label: "Manual adjustment", channel: "Manual" })
  );
}

function buildBillingStatusNotes(rows) {
  return (rows || [])
    .map((row) => {
      const oldValues = parseAuditValues(row.old_values);
      const newValues = parseAuditValues(row.new_values);
      const previousStatus = oldValues.billing_status || null;
      const billingStatus = newValues.billing_status || previousStatus;
      const previousPaymentStatus = oldValues.payment_status || null;
      const paymentStatus = newValues.payment_status || row.payment_status || null;
      const billingChanged =
        Boolean(billingStatus) && previousStatus !== billingStatus;
      const paymentChanged =
        Boolean(paymentStatus) && previousPaymentStatus !== paymentStatus;
      const isInitialStatus = row.action === "CREATE_BILLING";

      if (!isInitialStatus && !billingChanged && !paymentChanged) return null;

      const referenceNumber =
        row.reference_number || newValues.reference_number || null;
      const paymentMethod =
        row.payment_method || newValues.payment_method || null;
      const methodDetails = getPaymentMethodDetails(paymentMethod);
      const suppliedNote =
        newValues.status_note || row.payment_notes || null;

      let summary;
      if (isInitialStatus) {
        summary = `Billing statement created as ${getBillingStatusLabel(billingStatus)}.`;
      } else if (paymentMethod || referenceNumber) {
        summary = `Billing status: ${getBillingStatusLabel(billingStatus)}. Payment status: ${String(paymentStatus || "not recorded").replace(/_/g, " ")}. Reference: ${referenceNumber || "not available"}. Payment method: ${methodDetails.label} (${methodDetails.channel}).`;
        if (row.external_reference || newValues.external_reference) {
          summary += ` External reference: ${row.external_reference || newValues.external_reference}.`;
        }
      } else {
        summary = `Billing status changed from ${getBillingStatusLabel(previousStatus)} to ${getBillingStatusLabel(billingStatus)}.`;
      }
      if (suppliedNote) summary += ` Note: ${suppliedNote}`;

      return {
        status_note_id: row.audit_log_id,
        changed_at: row.changed_at,
        changed_by_name: row.changed_by_name,
        previous_status: previousStatus,
        billing_status: billingStatus,
        payment_status: paymentStatus,
        reference_number: referenceNumber,
        external_reference:
          row.external_reference || newValues.external_reference || null,
        payment_method: paymentMethod,
        payment_method_label: methodDetails.label,
        payment_channel: methodDetails.channel,
        note: summary,
      };
    })
    .filter(Boolean);
}

module.exports = {
  buildBillingStatusNotes,
  getBillingStatusLabel,
  getPaymentMethodDetails,
  parseAuditValues,
};
