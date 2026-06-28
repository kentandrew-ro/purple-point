async function signOut() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
}
