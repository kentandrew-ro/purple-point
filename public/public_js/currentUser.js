"use strict";

async function loadCurrentUser() {
  try {
    const response = await fetch("/api/me");
    if (!response.ok) return;

    const user = await response.json();
    const fullName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    const displayName = fullName || user.username || `User ${user.userId}`;
    const role = user.role
      ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
      : "User";

    document.querySelectorAll("[data-current-user-name]").forEach((element) => {
      element.textContent = displayName;
    });
    document.querySelectorAll("[data-current-user-role]").forEach((element) => {
      element.textContent = role;
    });
  } catch (error) {
    console.error("Unable to load the current user.", error);
  }
}

loadCurrentUser();
