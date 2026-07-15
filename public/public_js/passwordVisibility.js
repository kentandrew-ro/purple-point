"use strict";

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-password-toggle]");
  if (!button) return;

  const input = document.getElementById(button.dataset.passwordToggle);
  if (!input) return;

  const shouldShow = input.type === "password";
  input.type = shouldShow ? "text" : "password";
  button.textContent = shouldShow ? "Hide" : "Show";
  button.setAttribute("aria-pressed", String(shouldShow));
  button.setAttribute(
    "aria-label",
    `${shouldShow ? "Hide" : "Show"} ${input.id === "confirmPassword" ? "confirm " : ""}password`,
  );
});
