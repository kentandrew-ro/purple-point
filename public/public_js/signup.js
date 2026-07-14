"use strict";

const signupForm = document.getElementById("signup-form");
const signupButton = document.getElementById("signUpSubmit");
const signupMessage = document.getElementById("signup-message");

function showSignupMessage(message, type = "error") {
  signupMessage.textContent = message;
  signupMessage.classList.remove("error", "success");
  if (message && type) signupMessage.classList.add(type);
}

function isValidSignupEmail(email) {
  return /^[^\s@]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(
    email,
  );
}

function passwordValidationError(password) {
  if (password.length < 8) {
    return "Password must contain at least 8 characters.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter.";
  }
  if (!/[^A-Za-z0-9\s]/.test(password)) {
    return "Password must contain at least one special character.";
  }
  return "";
}

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const firstName = signupForm.elements.firstName.value.trim();
  const lastName = signupForm.elements.lastName.value.trim();
  const username = signupForm.elements.username.value.trim();
  const email = signupForm.elements.email.value.trim().toLowerCase();
  const password = signupForm.elements.password.value;
  const contactNumber = signupForm.elements.contactNumber.value.trim();

  if (
    !firstName ||
    !lastName ||
    !username ||
    !email ||
    !password ||
    !contactNumber
  ) {
    showSignupMessage("Please fill in all fields.");
    return;
  }

  if (!isValidSignupEmail(email)) {
    showSignupMessage(
      "Enter a valid email address with @ and a domain such as .com or .ph.",
    );
    signupForm.elements.email.focus();
    return;
  }

  const passwordError = passwordValidationError(password);
  if (passwordError) {
    showSignupMessage(passwordError);
    signupForm.elements.password.focus();
    return;
  }

  signupButton.disabled = true;
  signupButton.textContent = "Creating Account...";
  showSignupMessage("Creating your account...", "");

  try {
    const response = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName,
        lastName,
        username,
        email,
        password,
        contactNumber,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Unable to create your account.");
    }

    showSignupMessage(
      "Account created successfully. Opening sign in...",
      "success",
    );
    window.location.replace("/login.html");
  } catch (error) {
    console.error("Error during signup:", error);
    showSignupMessage(error.message || "Unable to create your account.");
  } finally {
    signupButton.disabled = false;
    signupButton.textContent = "Create Account";
  }
});

signupForm.addEventListener("input", () => showSignupMessage("", ""));
