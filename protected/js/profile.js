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
    email: form.email.value || "",
    house_no: form.house_no.value || "",
    street: form.street.value || "",
    barangay: form.barangay.value || "",
    city: form.city.value || "",
    zip_code: form.zip_code.value || "",
    blood_type: form.blood_type.value || "",
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

    resultBox.innerHTML = `<h2>Profile saved successfully!</h2>`;
  } catch (err) {
    resultBox.innerHTML = `<h2>Error</h2><p>${err?.message || "Unknown error"}</p>`;
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
      form.first_name.value = p.first_name || "";
      form.last_name.value = p.last_name || "";
      form.date_of_birth.value = p.date_of_birth
        ? p.date_of_birth.split("T")[0]
        : "";
      form.gender.value = p.gender || "";
      form.contact_number.value = p.contact_number || "";
      form.email.value = p.email || "";
      form.house_no.value = p.house_no || "";
      form.street.value = p.street || "";
      form.barangay.value = p.barangay || "";
      form.city.value = p.city || "";
      form.zip_code.value = p.zip_code || "";
      form.blood_type.value = p.blood_type || "";
    }
  } catch (err) {
    console.log("No existing profile data.");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("add-patient-form");
  if (form) {
    await prefillForm(form);
    form.addEventListener("submit", submitPatientForm);
  }
});
