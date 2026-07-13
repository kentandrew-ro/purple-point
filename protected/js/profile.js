"use strict";

const PROFILE_AUTOSAVE_FIELDS = [
  "first_name",
  "last_name",
  "date_of_birth",
  "gender",
  "contact_number",
  "house_no",
  "street",
  "barangay",
  "city",
  "zip_code",
  "blood_type",
  "emergency_contact_name",
  "emergency_contact_number",
  "patient_status",
];

let profileDraftKey = null;

function readProfileDraft() {
  if (!profileDraftKey) return {};
  try {
    return JSON.parse(localStorage.getItem(profileDraftKey) || "{}");
  } catch {
    return {};
  }
}

function fillProfileFields(form, values) {
  PROFILE_AUTOSAVE_FIELDS.forEach((name) => {
    const field = form.elements[name];
    if (field && values[name] !== null && values[name] !== undefined) {
      field.value = values[name];
    }
  });
}

function autosaveProfileDraft(form) {
  if (!profileDraftKey) return;
  const draft = {};
  PROFILE_AUTOSAVE_FIELDS.forEach((name) => {
    draft[name] = form.elements[name]?.value || "";
  });
  try {
    localStorage.setItem(profileDraftKey, JSON.stringify(draft));
    const resultBox = document.getElementById("add-patient-result");
    resultBox.textContent = "Changes saved automatically on this device.";
    resultBox.classList.remove("error", "success");
  } catch {}
}

async function submitPatientForm(e) {
  e.preventDefault();

  const form = e.target;
  const resultBox = document.getElementById("add-patient-result");
  resultBox.innerHTML = "";

  const payload = {
    first_name: form.first_name.value,
    last_name: form.last_name.value,
    date_of_birth: form.date_of_birth.value,
    gender: form.gender.value,
    contact_number: form.contact_number.value || "",
    house_no: form.house_no.value || "",
    street: form.street.value || "",
    barangay: form.barangay.value || "",
    city: form.city.value || "",
    zip_code: form.zip_code.value || "",
    blood_type: form.blood_type.value || "",
    emergency_contact_name: form.emergency_contact_name.value || "",
    emergency_contact_number: form.emergency_contact_number.value || "",
    patient_status: form.patient_status.value || "active",
  };

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    resultBox.textContent = "Saving profile...";

    const res = await fetch("/api/patients/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data?.error || "Failed to save profile");
    }

    if (profileDraftKey) localStorage.removeItem(profileDraftKey);
    resultBox.textContent = "Profile saved successfully!";
    resultBox.classList.add("success");
    resultBox.classList.remove("error");
  } catch (err) {
    resultBox.textContent = `Error: ${err?.message || "Unknown error"}`;
    resultBox.classList.add("error");
    resultBox.classList.remove("success");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function prefillForm(form) {
  try {
    const res = await fetch("/api/patients/me");
    const data = await res.json();

    if (data.ok && data.patient) {
      const p = data.patient;
      fillProfileFields(form, {
        ...p,
        date_of_birth: p.date_of_birth
          ? String(p.date_of_birth).slice(0, 10)
          : "",
        patient_status: p.patient_status || "active",
      });
    }
  } catch (err) {
    console.log("No existing profile data.");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("add-patient-form");
  if (form) {
    try {
      const meResponse = await fetch("/api/me");
      if (meResponse.ok) {
        const me = await meResponse.json();
        profileDraftKey = `purplepoint:profile-draft:${me.userId}`;
      }
    } catch {}

    await prefillForm(form);
    fillProfileFields(form, readProfileDraft());
    form.addEventListener("submit", submitPatientForm);
    form.addEventListener("input", () => autosaveProfileDraft(form));
    form.addEventListener("change", () => autosaveProfileDraft(form));
  }
});
