"use strict";

const PROFILE_DRAFT_FIELDS = [
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

let loginProfileDraftKey = null;

function setFormMessage(element, message, type = "") {
  if (!element) return;
  element.textContent = message;
  element.classList.remove("error", "success");
  if (type) element.classList.add(type);
}

function readDraft(key) {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) || "{}");
  } catch {
    return {};
  }
}

function saveProfileDraft(form) {
  if (!loginProfileDraftKey) return;
  const draft = {};
  PROFILE_DRAFT_FIELDS.forEach((name) => {
    draft[name] = form.elements[name]?.value || "";
  });
  try {
    localStorage.setItem(loginProfileDraftKey, JSON.stringify(draft));
  } catch {}
}

function fillProfileForm(form, values) {
  PROFILE_DRAFT_FIELDS.forEach((name) => {
    if (
      form.elements[name] &&
      values[name] !== null &&
      values[name] !== undefined
    ) {
      form.elements[name].value = values[name];
    }
  });
}

function profilePayload(form) {
  const payload = {};
  PROFILE_DRAFT_FIELDS.forEach((name) => {
    payload[name] = form.elements[name]?.value?.trim() || "";
  });
  return payload;
}

async function showProfileCompletion() {
  const loginPanel = document.getElementById("login-panel");
  const profilePanel = document.getElementById("login-profile-panel");
  const profileForm = document.getElementById("login-profile-form");
  const profileMessage = document.getElementById("login-profile-message");

  loginPanel.hidden = true;
  profilePanel.hidden = false;
  document.getElementById("auth-card").classList.add("profile-completion");
  setFormMessage(profileMessage, "Loading your profile...");

  const [meResponse, profileResponse] = await Promise.all([
    fetch("/api/me"),
    fetch("/api/patients/me"),
  ]);
  if (!meResponse.ok || !profileResponse.ok) {
    throw new Error("Unable to load your patient profile.");
  }

  const me = await meResponse.json();
  const profileData = await profileResponse.json();
  const patient = profileData.patient || {};
  loginProfileDraftKey = `purplepoint:profile-draft:${me.userId}`;

  fillProfileForm(profileForm, {
    ...patient,
    first_name: patient.first_name || me.firstName || "",
    last_name: patient.last_name || me.lastName || "",
    contact_number: patient.contact_number || me.contactNumber || "",
    date_of_birth: patient.date_of_birth
      ? String(patient.date_of_birth).slice(0, 10)
      : "",
    patient_status: patient.patient_status || "active",
  });
  fillProfileForm(profileForm, readDraft(loginProfileDraftKey));
  setFormMessage(
    profileMessage,
    "Your entries are saved automatically on this device.",
  );
}

async function handleLogin(event) {
  event.preventDefault();
  const identifier = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const submitButton = document.getElementById("loginSubmit");
  const message = document.getElementById("login-message");

  if (!identifier || !password) {
    setFormMessage(
      message,
      "Please enter both your username and password.",
      "error",
    );
    return;
  }

  submitButton.disabled = true;
  setFormMessage(message, "Signing in...");

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Unable to sign in.");
    }

    if (data.role === "admin") {
      window.location.replace("/adminPage.html");
      return;
    }

    if (!data.profileComplete) {
      await showProfileCompletion();
      return;
    }

    window.location.replace("/patientPage.html");
  } catch (error) {
    console.error("Error during login:", error);
    const profilePanel = document.getElementById("login-profile-panel");
    const visibleMessage = profilePanel.hidden
      ? message
      : document.getElementById("login-profile-message");
    setFormMessage(
      visibleMessage,
      error.message || "Unable to sign in.",
      "error",
    );
  } finally {
    submitButton.disabled = false;
  }
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]');
  const message = document.getElementById("login-profile-message");
  submitButton.disabled = true;
  setFormMessage(message, "Saving profile...");

  try {
    const response = await fetch("/api/patients/me", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profilePayload(form)),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to save your profile.");
    }

    if (loginProfileDraftKey) localStorage.removeItem(loginProfileDraftKey);
    setFormMessage(
      message,
      "Profile saved. Opening your patient portal...",
      "success",
    );
    window.location.replace("/patientPage.html");
  } catch (error) {
    console.error("Error saving patient profile:", error);
    setFormMessage(
      message,
      error.message || "Unable to save your profile.",
      "error",
    );
  } finally {
    submitButton.disabled = false;
  }
}

async function signOutFromProfileCompletion() {
  const message = document.getElementById("login-profile-message");
  try {
    const response = await fetch("/api/logout", { method: "POST" });
    if (!response.ok) throw new Error("Unable to sign out.");
    window.location.replace("/login.html");
  } catch (error) {
    setFormMessage(message, error.message || "Unable to sign out.", "error");
  }
}

document.getElementById("login-form").addEventListener("submit", handleLogin);
document
  .getElementById("login-profile-form")
  .addEventListener("submit", handleProfileSubmit);
document
  .getElementById("login-profile-form")
  .addEventListener("input", (event) => saveProfileDraft(event.currentTarget));
document
  .getElementById("login-profile-form")
  .addEventListener("change", (event) => saveProfileDraft(event.currentTarget));
document
  .getElementById("profile-signout")
  .addEventListener("click", signOutFromProfileCompletion);
document.getElementById("signupButton").addEventListener("click", () => {
  window.location.href = "/signup.html";
});
