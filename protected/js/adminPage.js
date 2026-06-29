function showTab(name) {
  document
    .querySelectorAll(".content > div")
    .forEach((el) => (el.style.display = "none"));
  const tab = document.getElementById("tab-" + name);
  if (tab) tab.style.display = "block";
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

const STATUS_COLORS = {
  confirmed: "#c8e6c9",
  completed: "#bbdefb",
  pending: "#fff9c4",
  scheduled: "#e1bee7",
  cancelled: "#ffcdd2",
};

function apptParseDateOnly(dateVal) {
  if (!dateVal) return null;
  const iso =
    typeof dateVal === "object" && typeof dateVal.toISOString === "function"
      ? dateVal.toISOString().slice(0, 10)
      : String(dateVal).slice(0, 10);
  const parts = iso.split("-").map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return null;
  return { year: parts[0], month: parts[1] - 1, day: parts[2] };
}

function apptFormatTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = String(timeStr).split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function renderAdminCalendar(appointments, container, baseDate) {
  if (!baseDate) baseDate = new Date();
  const yr = baseDate.getFullYear();
  const mo = baseDate.getMonth();

  const byDay = new Map();
  (appointments || []).forEach((a) => {
    const p = apptParseDateOnly(a.appointment_date);
    if (!p || p.year !== yr || p.month !== mo) return;
    if (!byDay.has(p.day)) byDay.set(p.day, []);
    byDay.get(p.day).push(a);
  });

  const monthLabel = baseDate.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const startWeekday = new Date(yr, mo, 1).getDay();

  container.innerHTML = `
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <button type="button" id="admin-cal-prev"
          style="border:1px solid #ccc;background:#fff;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:16px;">&#8249;</button>
        <strong style="font-size:15px;">${monthLabel}</strong>
        <button type="button" id="admin-cal-next"
          style="border:1px solid #ccc;background:#fff;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:16px;">&#8250;</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);border-top:1px solid #ccc;border-left:1px solid #ccc;">
        ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
          .map(
            (d) =>
              `<div style="padding:6px 8px;font-size:12px;font-weight:700;background:#f5f5f5;border-right:1px solid #ccc;border-bottom:1px solid #ccc;">${d}</div>`,
          )
          .join("")}
        <div id="admin-cal-body" style="display:contents;"></div>
      </div>
    </div>
  `;

  container.querySelector("#admin-cal-prev").addEventListener("click", () => {
    renderAdminCalendar(appointments, container, new Date(yr, mo - 1, 1));
  });
  container.querySelector("#admin-cal-next").addEventListener("click", () => {
    renderAdminCalendar(appointments, container, new Date(yr, mo + 1, 1));
  });

  const calBody = container.querySelector("#admin-cal-body");

  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement("div");
    empty.style.cssText =
      "min-height:100px;border-right:1px solid #ccc;border-bottom:1px solid #ccc;background:#fafafa;";
    calBody.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    cell.style.cssText =
      "min-height:100px;border-right:1px solid #ccc;border-bottom:1px solid #ccc;padding:4px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;";

    const dayNum = document.createElement("div");
    dayNum.style.cssText = "font-weight:bold;font-size:12px;margin-bottom:4px;";
    dayNum.textContent = day;
    cell.appendChild(dayNum);

    const items = (byDay.get(day) || []).sort((a, b) =>
      (a.appointment_time || "").localeCompare(b.appointment_time || ""),
    );

    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:3px;";

    if (items.length) {
      items.slice(0, 4).forEach((appt) => {
        const first = (appt.first_name || "").trim();
        const last = (appt.last_name || "").trim();
        const name =
          `${first ? first[0].toUpperCase() + "." : ""} ${last}`.trim();
        const time = apptFormatTime(appt.appointment_time);
        const status = (appt.appointment_status || "").toLowerCase();

        const tag = document.createElement("div");
        tag.style.cssText = `font-size:11px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:${STATUS_COLORS[status] || "#f0f0f0"};border-radius:3px;padding:2px 5px;`;
        tag.title = `${name} — ${time} — ${status}`;
        tag.textContent = `${name} — ${time}`;
        list.appendChild(tag);
      });

      if (items.length > 4) {
        const more = document.createElement("div");
        more.style.cssText = "font-size:11px;color:#666;margin-top:2px;";
        more.textContent = `+${items.length - 4} more`;
        list.appendChild(more);
      }
    } else {
      const dash = document.createElement("div");
      dash.style.cssText = "font-size:11px;color:#ccc;";
      dash.textContent = "—";
      list.appendChild(dash);
    }

    cell.appendChild(list);
    calBody.appendChild(cell);
  }
}

async function loadAdminAppointments() {
  const container = document.getElementById("admin-appointments-calendar");
  if (!container) return;
  container.textContent = "Loading appointments…";
  try {
    const res = await fetch("/api/appointments");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to load appointments");
    }
    const appointments = await res.json();
    renderAdminCalendar(appointments, container, new Date());
  } catch (err) {
    container.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
  }
}

(function () {
  document.addEventListener("click", (e) => {
    const el = e.target.closest("a[onclick]");
    if (!el) return;
    if (el.getAttribute("onclick")?.includes("view-appointments")) {
      loadAdminAppointments();
    }
  });
})();
