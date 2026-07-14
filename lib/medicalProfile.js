"use strict";

const DIABETES_STATUSES = Object.freeze(["unknown", "no", "yes"]);

function normalizeDiabetesStatus(value) {
  const normalized = String(value || "unknown").trim().toLowerCase();
  return DIABETES_STATUSES.includes(normalized) ? normalized : null;
}

function normalizeAllergies(value) {
  const entries = Array.isArray(value)
    ? value
    : String(value || "").split(/\r?\n/);
  const seen = new Set();
  const allergies = [];
  entries.forEach((entry) => {
    const allergen = String(entry || "").trim();
    const key = allergen.toLowerCase();
    if (!allergen || seen.has(key)) return;
    seen.add(key);
    allergies.push(allergen);
  });
  return allergies;
}

function getAllergyValidationError(allergies) {
  if (allergies.length > 50) {
    return "A patient cannot have more than 50 allergy entries.";
  }
  if (allergies.some((allergen) => allergen.length > 150)) {
    return "Each allergy must not exceed 150 characters.";
  }
  return null;
}

async function replacePatientAllergies(executor, patientId, allergies) {
  await executor.execute("DELETE FROM patient_allergies WHERE patient_id = ?", [
    patientId,
  ]);
  if (!allergies.length) return;
  const placeholders = allergies.map(() => "(?, ?)").join(", ");
  const values = allergies.flatMap((allergen) => [patientId, allergen]);
  await executor.execute(
    `INSERT INTO patient_allergies (patient_id, allergen)
     VALUES ${placeholders}`,
    values,
  );
}

module.exports = {
  DIABETES_STATUSES,
  getAllergyValidationError,
  normalizeAllergies,
  normalizeDiabetesStatus,
  replacePatientAllergies,
};
