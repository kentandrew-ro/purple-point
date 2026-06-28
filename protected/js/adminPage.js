function showTab(name) {
  document
    .querySelectorAll(".content > div")
    .forEach((el) => (el.style.display = "none"));
  const tab = document.getElementById("tab-" + name);
  if (tab) tab.style.display = "";
}

const now = new Date();
document.getElementById("welcome-date").textContent =
  "Welcome back, Admin. " +
  now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

async function loadStats() {
  try {
    const res = await fetch("/api/dashboard/stats");
    if (!res.ok) throw new Error("Failed to load stats");
    const data = await res.json();

    document.getElementById("stat-total-patients").textContent =
      data.total_patients ?? "--";
    document.getElementById("stat-appointments-today").textContent =
      data.appointments_today ?? "--";
    document.getElementById("stat-pending-review").textContent =
      data.pending_review ?? "--";
  } catch (err) {
    console.error(err);
    [
      "stat-total-patients",
      "stat-appointments-today",
      "stat-pending-review",
    ].forEach((id) => {
      document.getElementById(id).textContent = "!";
    });
  }
}

async function loadSchedule() {
  const tbody = document.getElementById("schedule-body");
  tbody.innerHTML = "<tr><td colspan='5'>Loading...</td></tr>";

  try {
    const res = await fetch("/api/dashboard/schedule");
    if (!res.ok) throw new Error("Failed to load schedule");
    const rows = await res.json();

    if (!rows.length) {
      tbody.innerHTML =
        "<tr><td colspan='5'>No appointments scheduled for today.</td></tr>";
      return;
    }

    tbody.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td>${row.time}</td>
          <td>${row.patient}</td>
          <td>--</td>
          <td>${row.reason}</td>
          <td><span class="badge">${row.status.toUpperCase()}</span></td>
        </tr>`,
      )
      .join("");
  } catch (err) {
    console.error(err);
    tbody.innerHTML = "<tr><td colspan='5'>Failed to load schedule.</td></tr>";
  }
}

async function signOut() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
}

loadStats();
loadSchedule();
