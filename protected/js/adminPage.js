function showTab(name) {
  document
    .querySelectorAll(".content > div")
    .forEach((el) => (el.style.display = "none"));
  const tab = document.getElementById("tab-" + name);
  if (tab) tab.style.display = "block";
  if (name === "billing") loadBillings();
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

let adminCalendarBaseDate = new Date();

function renderAdminCalendar(appointments, container, baseDate) {
  if (!baseDate) baseDate = new Date();
  adminCalendarBaseDate = baseDate;
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
        tag.style.cssText = `font-size:11px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:${STATUS_COLORS[status] || "#f0f0f0"};border-radius:3px;padding:2px 5px;cursor:pointer;`;
        tag.title = `${name} — ${time} — ${status} (click to update status)`;
        tag.textContent = `${name} — ${time}`;
        tag.addEventListener("click", () => {
          openApptStatusModal(appt, () =>
            loadAdminAppointments(adminCalendarBaseDate),
          );
        });
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

async function loadAdminAppointments(baseDate) {
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
    renderAdminCalendar(appointments, container, baseDate || new Date());
  } catch (err) {
    container.innerHTML = `<p style="color:red;">Error: ${err.message}</p>`;
  }
}

function closeApptStatusModal() {
  const el = document.getElementById("appt-status-modal-overlay");
  if (el) el.remove();
}

function openApptStatusModal(appt, onSaved) {
  closeApptStatusModal();

  const name = `${appt.first_name || ""} ${appt.last_name || ""}`.trim();
  const dateLabel = appt.appointment_date
    ? new Date(`${appt.appointment_date}T00:00:00`).toLocaleDateString()
    : "";
  const timeLabel = apptFormatTime(appt.appointment_time);
  const currentStatus = (appt.appointment_status || "").toLowerCase();
  const statuses = ["scheduled", "confirmed", "completed", "cancelled"];

  const overlay = document.createElement("div");
  overlay.id = "appt-status-modal-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:1000;";

  const box = document.createElement("div");
  box.style.cssText =
    "background:#fff;border-radius:10px;padding:20px;width:320px;max-width:90vw;box-shadow:0 10px 30px rgba(0,0,0,0.2);";
  box.innerHTML = `
    <h3 style="margin-top:0;margin-bottom:4px;">Update Appointment</h3>
    <p style="margin:0 0 12px;font-size:13px;color:#555;">${escapeHtml(name)} — ${escapeHtml(dateLabel)} ${escapeHtml(timeLabel)}</p>
    <div class="field">
      <label for="appt-status-select">Status</label>
      <select id="appt-status-select">
        ${statuses
          .map(
            (s) =>
              `<option value="${s}" ${s === currentStatus ? "selected" : ""}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`,
          )
          .join("")}
      </select>
    </div>
    <div class="field" id="appt-cancel-reason-field" style="display:none;margin-top:10px;">
      <label for="appt-cancel-reason">Cancellation Reason</label>
      <textarea id="appt-cancel-reason" rows="3" placeholder="Reason for cancelling"></textarea>
    </div>
    <div id="appt-status-error" style="color:red;font-size:13px;margin-top:8px;"></div>
    <div class="actions" style="margin-top:14px;">
      <button type="button" id="appt-status-save">Save</button>
      <button type="button" id="appt-status-close">Close</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const select = box.querySelector("#appt-status-select");
  const reasonField = box.querySelector("#appt-cancel-reason-field");
  const reasonInput = box.querySelector("#appt-cancel-reason");
  const errorEl = box.querySelector("#appt-status-error");

  function syncReasonField() {
    reasonField.style.display = select.value === "cancelled" ? "block" : "none";
  }
  syncReasonField();
  select.addEventListener("change", syncReasonField);

  box
    .querySelector("#appt-status-close")
    .addEventListener("click", closeApptStatusModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeApptStatusModal();
  });

  box.querySelector("#appt-status-save").addEventListener("click", async () => {
    errorEl.textContent = "";
    const newStatus = select.value;
    const payload = { status: newStatus };

    if (newStatus === "cancelled") {
      const reason = reasonInput.value.trim();
      if (!reason) {
        errorEl.textContent = "Please provide a cancellation reason.";
        return;
      }
      payload.cancel_reason = reason;
    }

    try {
      const res = await fetch(
        `/api/appointments/${appt.appointment_id}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to update appointment status.");
      }
      closeApptStatusModal();
      if (typeof onSaved === "function") onSaved();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
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

function getFormPayload(form, extra = {}) {
  const payload = { ...extra };
  const fd = new FormData(form);
  for (const [k, v] of fd.entries()) {
    payload[k] = typeof v === "string" ? v.trim() : v;
  }
  return payload;
}

function genderNormalize(gender) {
  const g = (gender || "").toLowerCase();
  if (g === "male" || g === "m") return "male";
  if (g === "female" || g === "f") return "female";
  return gender;
}

function debounce(fn, delay = 250) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

function formatUserLabel(user) {
  if (!user) return "";
  const name = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  return `${name} · ${user.email || user.username || ""}`;
}

function clearUserSuggestions() {
  const list = document.getElementById("user-suggestions");
  if (list) list.innerHTML = "";
}

function renderUserSuggestions(users) {
  const list = document.getElementById("user-suggestions");
  if (!list) return;

  if (!users || !users.length) {
    list.innerHTML =
      '<div style="padding:10px;color:#666;">No users found.</div>';
    return;
  }

  list.innerHTML = users
    .map(
      (user) =>
        `<div class="suggestion-item" data-user-id="${user.user_id}">${formatUserLabel(user)}</div>`,
    )
    .join("");
}

function renderPatientSuggestions(patients) {
  const list = document.getElementById("patient-suggestions");
  if (!list) return;
  if (!patients || !patients.length) {
    list.innerHTML =
      '<div style="padding:10px;color:#666;">No patients found.</div>';
    return;
  }
  list.innerHTML = patients
    .map(
      (p) =>
        `<div class="suggestion-item" data-patient-id="${p.patient_id}">${p.first_name} ${p.last_name} · ${p.email || p.contact_number || ""}</div>`,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPatientInfoSuggestions(patients) {
  const list = document.getElementById("patient-info-suggestions");
  if (!list) return;
  if (!patients || !patients.length) {
    list.innerHTML =
      '<div style="padding:10px;color:#666;">No patients found.</div>';
    return;
  }
  list.innerHTML = patients
    .map(
      (p) =>
        `<div class="suggestion-item" data-patient-id="${p.patient_id}">${p.first_name} ${p.last_name} · ${p.email || p.contact_number || ""}</div>`,
    )
    .join("");
}

function clearPatientInfoSuggestions() {
  const list = document.getElementById("patient-info-suggestions");
  if (list) list.innerHTML = "";
}

function clearPatientInfoDetails() {
  const box = document.getElementById("patient-info-details");
  if (box) box.innerHTML = "";
}

function renderPatientInfoDetails(patient) {
  const box = document.getElementById("patient-info-details");
  if (!box) return;

  if (!patient) {
    box.innerHTML =
      '<p style="color:#666;">Select a patient to view details.</p>';
    return;
  }

  const fullName =
    `${patient.first_name || ""} ${patient.last_name || ""}`.trim();
  const dob = patient.date_of_birth
    ? new Date(patient.date_of_birth).toLocaleDateString()
    : "Not provided";
  const address = [
    patient.house_no,
    patient.street,
    patient.barangay,
    patient.city,
    patient.zip_code,
  ]
    .filter(Boolean)
    .join(", ");

  box.innerHTML = `
    <div style="border:1px solid #ddd;border-radius:8px;padding:16px;background:#fafafa;">
      <h3 style="margin-top:0;">${escapeHtml(fullName || "Patient")}</h3>
      <p><strong>Email:</strong> ${escapeHtml(patient.email || "Not provided")}</p>
      <p><strong>Contact:</strong> ${escapeHtml(patient.contact_number || "Not provided")}</p>
      <p><strong>Date of birth:</strong> ${escapeHtml(dob)}</p>
      <p><strong>Gender:</strong> ${escapeHtml(patient.gender || "Not provided")}</p>
      <p><strong>Blood type:</strong> ${escapeHtml(patient.blood_type || "Not provided")}</p>
      <p><strong>Address:</strong> ${escapeHtml(address || "Not provided")}</p>
      <p><strong>Appointments:</strong> ${escapeHtml(String(patient.appointment_count || 0))}</p>
    </div>
  `;
}

function renderDentistSuggestions(dentists, target) {
  const list = document.getElementById(target);
  if (!list) return;
  if (!dentists || !dentists.length) {
    list.innerHTML =
      '<div style="padding:10px;color:#666;">No dentists found.</div>';
    return;
  }
  list.innerHTML = dentists
    .map(
      (d) =>
        `<div class="suggestion-item" data-dentist-id="${d.dentist_id}">${d.first_name} ${d.last_name} · ${d.specialization || d.email || ""}</div>`,
    )
    .join("");
}

function updateSelectedUserCard(user) {
  const card = document.getElementById("selected-user-card");
  const nameEl = document.getElementById("selected-user-name");
  const emailEl = document.getElementById("selected-user-email");
  const roleEl = document.getElementById("selected-user-role");

  if (!card || !nameEl || !emailEl || !roleEl) return;

  if (!user) {
    card.style.display = "none";
    nameEl.textContent = "";
    emailEl.textContent = "";
    roleEl.textContent = "";
    return;
  }

  card.style.display = "block";
  nameEl.textContent = `${user.first_name} ${user.last_name}`.trim();
  emailEl.textContent = user.email || "";
  roleEl.textContent = `Current role: ${user.role || "patient"}`;
}

async function searchUsers(query) {
  if (!query || query.trim().length < 1) {
    clearUserSuggestions();
    return;
  }

  try {
    const res = await fetch(
      `/api/admin/users/search?q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) throw new Error("Search failed");
    const users = await res.json();
    renderUserSuggestions(users);
  } catch (err) {
    console.error(err);
    renderUserSuggestions([]);
  }
}

async function searchPatients(query) {
  if (!query || query.trim().length < 1) {
    const list = document.getElementById("patient-suggestions");
    if (list) list.innerHTML = "";
    return;
  }
  try {
    const res = await fetch(
      `/api/patients/search?q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) throw new Error("Search failed");
    const items = await res.json();
    renderPatientSuggestions(items);
  } catch (err) {
    console.error(err);
    renderPatientSuggestions([]);
  }
}

async function searchPatientInfo(query) {
  if (!query || query.trim().length < 1) {
    clearPatientInfoSuggestions();
    clearPatientInfoDetails();
    return;
  }

  try {
    const res = await fetch(
      `/api/patients/search?q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) throw new Error("Search failed");
    const items = await res.json();
    renderPatientInfoSuggestions(items);
  } catch (err) {
    console.error(err);
    renderPatientInfoSuggestions([]);
  }
}

async function loadPatientInfoDetails(patientId) {
  if (!patientId) {
    renderPatientInfoDetails(null);
    return;
  }

  try {
    const res = await fetch(`/api/patients/${encodeURIComponent(patientId)}`);
    if (!res.ok) throw new Error("Unable to load patient details");
    const data = await res.json();
    renderPatientInfoDetails(data?.patient || null);
  } catch (err) {
    console.error(err);
    renderPatientInfoDetails(null);
  }
}

async function searchDentists(query, targetListId) {
  if (!query || query.trim().length < 1) {
    const list = document.getElementById(targetListId);
    if (list) list.innerHTML = "";
    return;
  }
  try {
    const res = await fetch(
      `/api/dentists/search?q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) throw new Error("Search failed");
    const items = await res.json();
    renderDentistSuggestions(items, targetListId);
  } catch (err) {
    console.error(err);
    renderDentistSuggestions([], targetListId);
  }
}

function showRoleSpecificFields() {
  const role = document.getElementById("promote-role")?.value;
  const doctorExtra = document.getElementById("doctor-extra");
  const staffExtra = document.getElementById("staff-extra");
  const extraWrapper = document.getElementById("role-extra-fields");

  if (!extraWrapper) return;

  if (role === "doctor") {
    extraWrapper.style.display = "block";
    if (doctorExtra) doctorExtra.style.display = "block";
    if (staffExtra) staffExtra.style.display = "none";
  } else if (role === "staff") {
    extraWrapper.style.display = "block";
    if (doctorExtra) doctorExtra.style.display = "none";
    if (staffExtra) staffExtra.style.display = "block";
  } else {
    extraWrapper.style.display = "none";
    if (doctorExtra) doctorExtra.style.display = "none";
    if (staffExtra) staffExtra.style.display = "none";
  }
}

async function promoteSelectedUser() {
  const userId = document.getElementById("selected-user-id")?.value;
  const role = document.getElementById("promote-role")?.value;
  const resultBox = document.getElementById("promote-result");
  const submitBtn = document.getElementById("promote-user-button");

  if (submitBtn) submitBtn.disabled = true;
  showResult(resultBox, "Promoting user...");

  try {
    if (!userId || !role) {
      throw new Error("Please select a user and role before promoting.");
    }

    const payload = {
      user_id: Number(userId),
      role,
      hire_date: document.getElementById("promote_hire_date")?.value,
      specialization: document.getElementById("specialization")?.value,
      license_number: document.getElementById("license_number")?.value,
      shift_schedule: document.getElementById("shift_schedule")?.value,
    };

    const res = await fetch("/api/admin/users/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to promote user.");
    }

    showResult(
      resultBox,
      `<h3>User promoted successfully!</h3><p>New ${data.role} profile created: ID ${data.doctor_id || data.staff_id}.</p>`,
    );
    loadDoctorStaffSummaries();
    document.getElementById("user-search").value = "";
    document.getElementById("selected-user-id").value = "";
    updateSelectedUserCard(null);
    clearUserSuggestions();
    document.getElementById("promote-role").value = "";
    showRoleSpecificFields();
  } catch (err) {
    showResult(
      resultBox,
      `<h3 style="color:red;">Error</h3><p>${err?.message || "Unknown error"}</p>`,
    );
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadDoctorStaffSummaries() {
  const doctorCount = document.getElementById("doctor-summary-count");
  const staffCount = document.getElementById("staff-summary-count");
  const doctorList = document.getElementById("doctor-summary-list");
  const staffList = document.getElementById("staff-summary-list");

  if (doctorCount) doctorCount.textContent = "...";
  if (staffCount) staffCount.textContent = "...";
  if (doctorList) doctorList.innerHTML = "Loading...";
  if (staffList) staffList.innerHTML = "Loading...";

  try {
    const res = await fetch("/api/admin/users/summary");
    if (!res.ok) throw new Error("Failed to load summaries");
    const data = await res.json();

    if (doctorCount) doctorCount.textContent = String(data.total_doctors ?? 0);
    if (staffCount) staffCount.textContent = String(data.total_staff ?? 0);
    if (doctorList)
      doctorList.innerHTML =
        data.doctors?.length > 0
          ? data.doctors
              .map((item) => `<div>${item.name} — ${item.specialization}</div>`)
              .join("")
          : '<div style="color:#666;">No doctors yet.</div>';
    if (staffList)
      staffList.innerHTML =
        data.staff?.length > 0
          ? data.staff
              .map((item) => `<div>${item.name} — ${item.shift_schedule}</div>`)
              .join("")
          : '<div style="color:#666;">No staff yet.</div>';
  } catch (err) {
    console.error(err);
    if (doctorCount) doctorCount.textContent = "0";
    if (staffCount) staffCount.textContent = "0";
    if (doctorList)
      doctorList.innerHTML =
        '<div style="color:red;">Unable to load doctor summary.</div>';
    if (staffList)
      staffList.innerHTML =
        '<div style="color:red;">Unable to load staff summary.</div>';
  }
}

function bindUserSuggestionClicks(event) {
  const item = event.target.closest(".suggestion-item");
  if (!item) return;

  const userId = item.dataset.userId;
  const query = item.textContent || "";
  const userText = query.trim();
  const [namePart, emailPart] = userText.split("·").map((part) => part.trim());

  document.getElementById("selected-user-id").value = userId;
  document.getElementById("user-search").value =
    namePart || emailPart || userText;
  updateSelectedUserCard({
    first_name: namePart,
    last_name: "",
    email: emailPart || "",
    role: "patient",
  });
  clearUserSuggestions();
}

function submitAppointmentForm(event) {
  if (typeof handleAddSubmit === "function") {
    return handleAddSubmit(event);
  }
  event.preventDefault();
  console.error("handleAddSubmit is not defined");
}

function showResult(el, html) {
  if (!el) return;
  el.innerHTML = html;
}

async function submitClinicHoursForm(e) {
  e.preventDefault();
  const form = e.target;
  const resultBox = document.getElementById("clinic-hours-result");
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  showResult(resultBox, "Saving clinic hours...");

  try {
    const payload = getFormPayload(form);
    const missing = [];
    if (!payload.dentist_id) missing.push("dentist_id");
    if (!payload.day_of_week) missing.push("day_of_week");
    if (!payload.start_time) missing.push("start_time");
    if (!payload.end_time) missing.push("end_time");

    if (missing.length) {
      throw new Error(`Missing field(s): ${missing.join(", ")}`);
    }

    if (payload.start_time >= payload.end_time) {
      throw new Error("Start time must be before end time.");
    }

    const res = await fetch("/api/dentist-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to save clinic hours");
    }

    showResult(
      resultBox,
      `<h3>Clinic hours saved successfully!</h3><p>Schedule ID: ${data.schedule_id ?? "N/A"}</p>`,
    );
    form.reset();
  } catch (err) {
    showResult(
      resultBox,
      `<h3 style="color:red;">Error</h3><p>${err?.message || "Unknown error"}</p>`,
    );
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function submitStaffForm(e) {
  e.preventDefault();

  const form = e.target;
  const resultBox = document.getElementById("staff-form-result");
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  showResult(resultBox, "Saving staff...");

  try {
    const payload = getFormPayload(form);
    payload.gender = genderNormalize(payload.gender);

    const res = await fetch("/api/staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to add staff");
    }

    showResult(
      resultBox,
      `
      <h3>Staff saved successfully!</h3>
      <p>Staff ID: ${data.staff_id}</p>
      <p>Inserted Staff User ID: ${data.user_id ?? "N/A"}</p>
    `,
    );

    form.reset();
  } catch (err) {
    showResult(
      resultBox,
      `<h3 style="color:red;">Database Error</h3><p>${err?.message ? String(err.message) : "Unknown error"}</p>`,
    );
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function submitDoctorForm(e) {
  e.preventDefault();

  const form = e.target;
  const resultBox = document.getElementById("doctor-form-result");
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  showResult(resultBox, "Saving doctor...");

  try {
    const payload = getFormPayload(form);
    payload.gender = genderNormalize(payload.gender);
    payload.employment_status = "Active";
    payload.license_number =
      payload.license_number === "" ? null : Number(payload.license_number);

    const res = await fetch("/api/doctors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to add doctor");
    }

    showResult(
      resultBox,
      `
      <h3>Doctor saved successfully!</h3>
      <p>Doctor ID: ${data.doctor_id ?? "N/A"}</p>
    `,
    );

    form.reset();
  } catch (err) {
    showResult(
      resultBox,
      `<h3 style="color:red;">Database Error</h3><p>${err?.message ? String(err.message) : "Unknown error"}</p>`,
    );
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const btnDoctor = document.getElementById("btn-show-doctor");
  const btnStaff = document.getElementById("btn-show-staff");
  const doctorCard = document.getElementById("doctor-form-card");
  const staffCard = document.getElementById("staff-form-card");
  const btnAppointment = document.getElementById("btn-show-add");
  const btnClinicHours = document.getElementById("btn-show-cancel");
  const appointmentCard = document.getElementById("appointment-form-card");
  const clinicHoursCard = document.getElementById("clinic-hours-form-card");

  function showDoctorForm() {
    if (doctorCard) doctorCard.style.display = "block";
    if (staffCard) staffCard.style.display = "none";
  }

  function showStaffForm() {
    if (doctorCard) doctorCard.style.display = "none";
    if (staffCard) staffCard.style.display = "block";
  }

  function showAppointmentForm() {
    if (appointmentCard) appointmentCard.style.display = "block";
    if (clinicHoursCard) clinicHoursCard.style.display = "none";
  }

  function showClinicHoursForm() {
    if (appointmentCard) appointmentCard.style.display = "none";
    if (clinicHoursCard) clinicHoursCard.style.display = "block";
  }

  if (btnDoctor) btnDoctor.addEventListener("click", showDoctorForm);
  if (btnStaff) btnStaff.addEventListener("click", showStaffForm);
  if (btnAppointment)
    btnAppointment.addEventListener("click", showAppointmentForm);
  if (btnClinicHours)
    btnClinicHours.addEventListener("click", showClinicHoursForm);

  const doctorForm = document.getElementById("doctor-form");
  const staffForm = document.getElementById("staff-form");
  const appointmentForm = document.getElementById("add-appointment-form");
  const clinicHoursForm = document.getElementById("clinic-hours-form");

  if (doctorForm) doctorForm.addEventListener("submit", submitDoctorForm);
  if (staffForm) staffForm.addEventListener("submit", submitStaffForm);
  if (appointmentForm)
    appointmentForm.addEventListener(
      "submit",
      typeof handleAddSubmit === "function"
        ? handleAddSubmit
        : submitAppointmentForm,
    );
  if (clinicHoursForm)
    clinicHoursForm.addEventListener("submit", submitClinicHoursForm);

  const userSearchInput = document.getElementById("user-search");
  const userSuggestions = document.getElementById("user-suggestions");
  const promoteRole = document.getElementById("promote-role");
  const promoteButton = document.getElementById("promote-user-button");

  if (userSearchInput) {
    userSearchInput.addEventListener(
      "input",
      debounce((event) => searchUsers(event.target.value || ""), 250),
    );
  }

  const patientSearch = document.getElementById("patient-search");
  const patientSuggestions = document.getElementById("patient-suggestions");
  if (patientSearch) {
    patientSearch.addEventListener(
      "input",
      debounce((e) => searchPatients(e.target.value || ""), 200),
    );
  }
  if (patientSuggestions) {
    patientSuggestions.addEventListener("click", (e) => {
      const el = e.target.closest(".suggestion-item");
      if (!el) return;
      const id = el.dataset.patientId;
      const label = el.textContent || "";
      document.getElementById("patient_id").value = id;
      document.getElementById("patient-search").value = label
        .split("·")[0]
        .trim();
      patientSuggestions.innerHTML = "";
    });
  }

  const patientInfoSearch = document.getElementById("patient-info-search");
  const patientInfoSuggestions = document.getElementById(
    "patient-info-suggestions",
  );
  if (patientInfoSearch) {
    patientInfoSearch.addEventListener(
      "input",
      debounce((e) => searchPatientInfo(e.target.value || ""), 200),
    );
  }
  if (patientInfoSuggestions) {
    patientInfoSuggestions.addEventListener("click", async (e) => {
      const el = e.target.closest(".suggestion-item");
      if (!el) return;
      const id = el.dataset.patientId;
      const label = el.textContent || "";
      if (patientInfoSearch)
        patientInfoSearch.value = label.split("·")[0].trim();
      patientInfoSuggestions.innerHTML = "";
      await loadPatientInfoDetails(id);
    });
  }

  const clinicDentistSearch = document.getElementById("clinic-dentist-search");
  const clinicDentistSuggestions = document.getElementById(
    "clinic-dentist-suggestions",
  );
  if (clinicDentistSearch) {
    clinicDentistSearch.addEventListener(
      "input",
      debounce(
        (e) =>
          searchDentists(e.target.value || "", "clinic-dentist-suggestions"),
        200,
      ),
    );
  }
  if (clinicDentistSuggestions) {
    clinicDentistSuggestions.addEventListener("click", (e) => {
      const el = e.target.closest(".suggestion-item");
      if (!el) return;
      const id = el.dataset.dentistId;
      const label = el.textContent || "";
      document.getElementById("clinic_dentist_id").value = id;
      document.getElementById("clinic-dentist-search").value = label
        .split("·")[0]
        .trim();
      clinicDentistSuggestions.innerHTML = "";
    });
  }

  if (userSuggestions) {
    userSuggestions.addEventListener("click", bindUserSuggestionClicks);
  }

  if (promoteRole) {
    promoteRole.addEventListener("change", showRoleSpecificFields);
  }

  if (promoteButton) {
    promoteButton.addEventListener("click", promoteSelectedUser);
  }

  document.addEventListener("click", (event) => {
    if (
      !event.target.closest("#user-search") &&
      !event.target.closest("#user-suggestions")
    ) {
      clearUserSuggestions();
    }
    if (
      !event.target.closest("#patient-info-search") &&
      !event.target.closest("#patient-info-suggestions")
    ) {
      clearPatientInfoSuggestions();
    }
    if (
      !event.target.closest("#dental-patient-search") &&
      !event.target.closest("#dental-patient-suggestions")
    ) {
      clearDentalPatientSuggestions();
    }
    if (
      !event.target.closest("#treatment-dentist-search") &&
      !event.target.closest("#treatment-dentist-suggestions")
    ) {
      const list = document.getElementById("treatment-dentist-suggestions");
      if (list) list.innerHTML = "";
    }
  });

  loadDoctorStaffSummaries();
  initDentalRecordsTab();
  initBillingTab();
});

const TOOTH_STATUS_ORDER = [
  "healthy",
  "treated",
  "needs_attention",
  "extracted",
];

const TOOTH_STATUS_LABELS = {
  healthy: "Healthy",
  treated: "Treated",
  needs_attention: "Needs Attention",
  extracted: "Extracted",
};

const TOOTH_STATUS_STYLES = {
  healthy: { bg: "#ffffff", border: "#ccc", color: "#333" },
  treated: { bg: "#c8e6c9", border: "#4caf50", color: "#256029" },
  needs_attention: { bg: "#ffe0b2", border: "#fb8c00", color: "#8a4b00" },
  extracted: { bg: "#ffcdd2", border: "#e53935", color: "#8e0000" },
};

let dentalCurrentPatientId = null;
let dentalTreatmentsById = new Map();
let dentalEditingTreatmentId = null;

function clearDentalPatientSuggestions() {
  const list = document.getElementById("dental-patient-suggestions");
  if (list) list.innerHTML = "";
}

function renderDentalPatientSuggestions(patients) {
  const list = document.getElementById("dental-patient-suggestions");
  if (!list) return;
  if (!patients || !patients.length) {
    list.innerHTML =
      '<div style="padding:10px;color:#666;">No patients found.</div>';
    return;
  }
  list.innerHTML = patients
    .map(
      (p) =>
        `<div class="suggestion-item" data-patient-id="${p.patient_id}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)} · ${escapeHtml(p.email || p.contact_number || "")}</div>`,
    )
    .join("");
}

async function searchDentalPatients(query) {
  const q = (query || "").trim();
  if (!q) {
    clearDentalPatientSuggestions();
    return;
  }
  try {
    const res = await fetch(`/api/patients/search?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error("Search failed");
    const items = await res.json();
    renderDentalPatientSuggestions(items);
  } catch (err) {
    console.error(err);
    renderDentalPatientSuggestions([]);
  }
}

function toothBox(num, status) {
  const style = TOOTH_STATUS_STYLES[status] || TOOTH_STATUS_STYLES.healthy;
  return `
    <div class="tooth-box" data-tooth="${num}" data-status="${status}"
      title="Tooth ${num} — ${TOOTH_STATUS_LABELS[status] || "Healthy"} (click to change)"
      style="
        width:42px;
        text-align:center;
        padding:6px 2px;
        border:2px solid ${style.border};
        background:${style.bg};
        color:${style.color};
        border-radius:6px;
        cursor:pointer;
        font-size:11px;
        user-select:none;
      ">
      <div style="font-weight:bold;">${num}</div>
    </div>`;
}

function renderToothChart(container, toothChart) {
  if (!container) return;

  const upperRow = [];
  for (let i = 1; i <= 16; i++) {
    upperRow.push(toothBox(i, toothChart[i] || "healthy"));
  }
  const lowerRow = [];
  for (let i = 17; i <= 32; i++) {
    lowerRow.push(toothBox(i, toothChart[i] || "healthy"));
  }

  container.innerHTML = `
    <div style="text-align:center;font-size:12px;color:#666;letter-spacing:0.05em;margin-bottom:8px;">UPPER ARCH</div>
    <div style="display:flex;justify-content:center;flex-wrap:wrap;gap:6px;">${upperRow.join("")}</div>
    <div style="display:flex;justify-content:center;flex-wrap:wrap;gap:6px;margin-top:12px;">${lowerRow.join("")}</div>
    <div style="text-align:center;font-size:12px;color:#666;letter-spacing:0.05em;margin-top:8px;">LOWER ARCH</div>
  `;

  container.querySelectorAll(".tooth-box").forEach((box) => {
    box.addEventListener("click", () => handleToothClick(box));
  });
}

async function handleToothClick(box) {
  if (!dentalCurrentPatientId) return;

  const toothNum = box.dataset.tooth;
  const current = box.dataset.status || "healthy";
  const nextIndex =
    (TOOTH_STATUS_ORDER.indexOf(current) + 1) % TOOTH_STATUS_ORDER.length;
  const next = TOOTH_STATUS_ORDER[nextIndex];

  const style = TOOTH_STATUS_STYLES[next];
  box.dataset.status = next;
  box.style.borderColor = style.border;
  box.style.background = style.bg;
  box.style.color = style.color;
  box.title = `Tooth ${toothNum} — ${TOOTH_STATUS_LABELS[next]} (click to change)`;

  try {
    const res = await fetch("/api/tooth-chart", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_id: dentalCurrentPatientId,
        tooth_number: toothNum,
        condition_status: next,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to update tooth status");
    }
  } catch (err) {
    console.error(err);
    const revertStyle = TOOTH_STATUS_STYLES[current];
    box.dataset.status = current;
    box.style.borderColor = revertStyle.border;
    box.style.background = revertStyle.bg;
    box.style.color = revertStyle.color;
    box.title = `Tooth ${toothNum} — ${TOOTH_STATUS_LABELS[current]} (click to change)`;
    alert(
      `Could not save tooth status: ${err?.message || "Please try again."}`,
    );
  }
}

function renderToothChartLegend(container) {
  if (!container) return;
  container.innerHTML = TOOTH_STATUS_ORDER.map((status) => {
    const style = TOOTH_STATUS_STYLES[status];
    return `
      <span style="display:inline-flex;align-items:center;gap:6px;">
        <span style="display:inline-block;width:12px;height:12px;border:2px solid ${style.border};background:${style.bg};border-radius:2px;"></span>
        ${TOOTH_STATUS_LABELS[status]}
      </span>`;
  }).join("");
}

function toDateInputValue(dateStr) {
  if (!dateStr) return "";
  const s = String(dateStr);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function formatDentalDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function renderTreatmentsTable(treatments) {
  const tbody = document.getElementById("treatments-body");
  if (!tbody) return;
  if (!treatments || !treatments.length) {
    tbody.innerHTML = "<tr><td colspan='8'>No treatments recorded.</td></tr>";
    return;
  }
  tbody.innerHTML = treatments
    .map(
      (t) => `
      <tr>
        <td>${escapeHtml(formatDentalDate(t.date))}</td>
        <td>${escapeHtml(t.procedure)}</td>
        <td>${escapeHtml(t.category || "—")}</td>
        <td>${
          t.price !== null && t.price !== undefined && t.price !== ""
            ? escapeHtml(Number(t.price).toFixed(2))
            : "—"
        }</td>
        <td>${escapeHtml(t.teeth)}</td>
        <td>${escapeHtml(t.doctor)}</td>
        <td>${escapeHtml(t.notes)}</td>
        <td>
          <button
            type="button"
            class="btn-edit-treatment"
            data-treatment-id="${escapeHtml(t.treatment_id)}"
          >
            Edit
          </button>
        </td>
      </tr>`,
    )
    .join("");

  dentalTreatmentsById = new Map(
    treatments.map((t) => [String(t.treatment_id), t]),
  );
}

function renderVitalsTable(vitals) {
  const tbody = document.getElementById("vitals-body");
  if (!tbody) return;
  if (!vitals || !vitals.length) {
    tbody.innerHTML = "<tr><td colspan='5'>No vitals recorded.</td></tr>";
    return;
  }
  tbody.innerHTML = vitals
    .map(
      (v) => `
      <tr>
        <td>${escapeHtml(formatDentalDate(v.date))}</td>
        <td>${escapeHtml(v.bp)}</td>
        <td>${escapeHtml(v.pulse)}</td>
        <td>${escapeHtml(v.temp)}</td>
        <td>${escapeHtml(v.weight)}</td>
      </tr>`,
    )
    .join("");
}

function showDentalSubtab(name) {
  document.querySelectorAll(".dental-subtab-content").forEach((el) => {
    el.style.display = "none";
  });
  const active = document.getElementById("dental-subtab-" + name);
  if (active) active.style.display = "block";

  document.querySelectorAll(".dental-subtab-btn").forEach((btn) => {
    const isActive = btn.dataset.subtab === name;
    btn.style.fontWeight = isActive ? "bold" : "normal";
    btn.style.textDecoration = isActive ? "underline" : "none";
  });
}

async function loadDentalPatientRecord(patientId) {
  const card = document.getElementById("dental-record-card");
  if (!patientId || !card) return;

  try {
    const res = await fetch(
      `/api/dental-records/patient/${encodeURIComponent(patientId)}`,
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to load dental record");
    }

    dentalCurrentPatientId = data.patient.patient_id;
    card.style.display = "block";

    document.getElementById("dental-patient-name").textContent =
      data.patient.name;
    document.getElementById("dental-patient-meta").textContent =
      `P-${String(data.patient.patient_id).padStart(3, "0")} | ${data.patient.blood_type} | ${formatDentalDate(data.patient.date_of_birth)} | ${data.patient.status.charAt(0).toUpperCase() + data.patient.status.slice(1)}`;

    renderToothChart(
      document.getElementById("tooth-chart-container"),
      data.tooth_chart || {},
    );
    renderToothChartLegend(document.getElementById("tooth-chart-legend"));
    renderTreatmentsTable(data.treatments);
    renderVitalsTable(data.vitals);
    loadPatientAppointmentsForTreatmentForm(dentalCurrentPatientId);

    showDentalSubtab("tooth-chart");

    resetTreatmentFormToAddMode();
    document.getElementById("add-treatment-card").style.display = "none";
    document.getElementById("record-vitals-card").style.display = "none";
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to load patient dental record.");
  }
}

async function loadPatientAppointmentsForTreatmentForm(patientId) {
  const select = document.getElementById("treatment_appointment");
  if (!select || !patientId) return;

  select.innerHTML = `<option value="">— No appointment —</option>`;

  try {
    const res = await fetch(
      `/api/appointments/patient/${encodeURIComponent(patientId)}`,
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return;

    (data.appointments || []).forEach((a) => {
      if (a.has_dental_record) return; // already tied to a record
      const opt = document.createElement("option");
      opt.value = a.appointment_id;
      opt.dataset.dentistId = a.dentist_id || "";
      opt.dataset.date = a.appointment_date;
      const doctor =
        a.doctor_name && a.doctor_name.trim() !== "Dr."
          ? ` · ${a.doctor_name}`
          : "";
      opt.textContent = `${formatDentalDate(a.appointment_date)} · ${a.appointment_type}${doctor} (${a.appointment_status})`;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error(err);
  }
}

function resetTreatmentFormToAddMode() {
  dentalEditingTreatmentId = null;
  const form = document.getElementById("add-treatment-form");
  if (form) form.reset();
  const idField = document.getElementById("treatment_id");
  if (idField) idField.value = "";
  const dentistIdField = document.getElementById("treatment_dentist_id");
  if (dentistIdField) dentistIdField.value = "";
  const appointmentField = document.getElementById("treatment_appointment");
  if (appointmentField) appointmentField.value = "";
  const title = document.getElementById("treatment-form-title");
  if (title) title.textContent = "Add Treatment";
  const submitBtn = document.getElementById("treatment-form-submit-btn");
  if (submitBtn) submitBtn.textContent = "Save Treatment";
}

function initDentalRecordsTab() {
  const searchInput = document.getElementById("dental-patient-search");
  const suggestions = document.getElementById("dental-patient-suggestions");

  if (searchInput) {
    searchInput.addEventListener(
      "input",
      debounce((e) => searchDentalPatients(e.target.value || ""), 200),
    );
  }

  if (suggestions) {
    suggestions.addEventListener("click", (e) => {
      const item = e.target.closest(".suggestion-item");
      if (!item) return;
      const patientId = item.dataset.patientId;
      loadDentalPatientRecord(patientId);
      clearDentalPatientSuggestions();
      if (searchInput) searchInput.value = "";
    });
  }

  document.querySelectorAll(".dental-subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => showDentalSubtab(btn.dataset.subtab));
  });

  const btnAddTreatment = document.getElementById("btn-add-treatment");
  const addTreatmentCard = document.getElementById("add-treatment-card");
  const addTreatmentForm = document.getElementById("add-treatment-form");
  const treatmentFormTitle = document.getElementById("treatment-form-title");
  const treatmentFormSubmitBtn = document.getElementById(
    "treatment-form-submit-btn",
  );
  const treatmentsBody = document.getElementById("treatments-body");
  const btnCancelAddTreatment = document.getElementById(
    "btn-cancel-add-treatment",
  );
  const treatmentDentistSearch = document.getElementById(
    "treatment-dentist-search",
  );
  const treatmentDentistSuggestions = document.getElementById(
    "treatment-dentist-suggestions",
  );

  function enterEditTreatmentMode(treatment) {
    dentalEditingTreatmentId = treatment.treatment_id;
    showDentalSubtab("treatments");
    addTreatmentCard.style.display = "block";

    document.getElementById("treatment_id").value = treatment.treatment_id;
    document.getElementById("treatment_date").value = toDateInputValue(
      treatment.date,
    );
    document.getElementById("treatment_procedure").value =
      treatment.procedure || "";
    document.getElementById("treatment_teeth").value = treatment.teeth || "";
    document.getElementById("treatment_notes").value = treatment.notes || "";
    document.getElementById("treatment_dentist_id").value =
      treatment.dentist_id || "";
    document.getElementById("treatment_price").value =
      treatment.price !== null && treatment.price !== undefined
        ? treatment.price
        : "";
    document.getElementById("treatment_duration").value =
      treatment.duration !== null && treatment.duration !== undefined
        ? treatment.duration
        : "";
    document.getElementById("treatment_category").value =
      treatment.category || "";
    treatmentDentistSearch.value = treatment.doctor || "";
    treatmentDentistSuggestions.innerHTML = "";

    if (treatmentFormTitle) treatmentFormTitle.textContent = "Edit Treatment";
    if (treatmentFormSubmitBtn)
      treatmentFormSubmitBtn.textContent = "Update Treatment";
  }

  if (btnAddTreatment) {
    btnAddTreatment.addEventListener("click", () => {
      if (!dentalCurrentPatientId) return;
      resetTreatmentFormToAddMode();
      showDentalSubtab("treatments");
      addTreatmentCard.style.display = "block";
    });
  }

  if (treatmentsBody) {
    treatmentsBody.addEventListener("click", (e) => {
      const btn = e.target.closest(".btn-edit-treatment");
      if (!btn) return;
      const treatment = dentalTreatmentsById.get(btn.dataset.treatmentId);
      if (!treatment) return;
      enterEditTreatmentMode(treatment);
    });
  }

  if (btnCancelAddTreatment) {
    btnCancelAddTreatment.addEventListener("click", () => {
      addTreatmentCard.style.display = "none";
      resetTreatmentFormToAddMode();
    });
  }

  if (treatmentDentistSearch) {
    treatmentDentistSearch.addEventListener(
      "input",
      debounce(
        (e) =>
          searchDentists(e.target.value || "", "treatment-dentist-suggestions"),
        200,
      ),
    );
  }

  if (treatmentDentistSuggestions) {
    treatmentDentistSuggestions.addEventListener("click", (e) => {
      const el = e.target.closest(".suggestion-item");
      if (!el) return;
      const id = el.dataset.dentistId;
      const label = el.textContent || "";
      document.getElementById("treatment_dentist_id").value = id;
      treatmentDentistSearch.value = label.split("·")[0].trim();
      treatmentDentistSuggestions.innerHTML = "";
    });
  }

  const treatmentAppointmentSelect = document.getElementById(
    "treatment_appointment",
  );
  if (treatmentAppointmentSelect) {
    treatmentAppointmentSelect.addEventListener("change", (e) => {
      const opt = e.target.selectedOptions[0];
      if (!opt || !opt.value) return;
      if (opt.dataset.date) {
        document.getElementById("treatment_date").value = opt.dataset.date;
      }
      if (opt.dataset.dentistId) {
        document.getElementById("treatment_dentist_id").value =
          opt.dataset.dentistId;
      }
    });
  }

  if (addTreatmentForm) {
    addTreatmentForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!dentalCurrentPatientId) return;

      const isEditing = Boolean(dentalEditingTreatmentId);

      const payload = {
        patient_id: dentalCurrentPatientId,
        appointment_id:
          document.getElementById("treatment_appointment").value || null,
        dentist_id:
          document.getElementById("treatment_dentist_id").value || null,
        visit_date: document.getElementById("treatment_date").value,
        procedure: document.getElementById("treatment_procedure").value,
        teeth_involved: document.getElementById("treatment_teeth").value,
        notes: document.getElementById("treatment_notes").value,
        price: document.getElementById("treatment_price").value,
        duration: document.getElementById("treatment_duration").value,
        category: document.getElementById("treatment_category").value,
      };

      const url = isEditing
        ? `/api/dental-records/${encodeURIComponent(dentalEditingTreatmentId)}`
        : "/api/dental-records";

      try {
        const res = await fetch(url, {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(
            data.error ||
              (isEditing
                ? "Failed to update treatment"
                : "Failed to save treatment"),
          );
        }

        await loadDentalPatientRecord(dentalCurrentPatientId);
        resetTreatmentFormToAddMode();
        addTreatmentCard.style.display = "none";
      } catch (err) {
        console.error(err);
        alert(
          err.message ||
            (isEditing
              ? "Failed to update treatment."
              : "Failed to save treatment."),
        );
      }
    });
  }

  const btnRecordVitals = document.getElementById("btn-record-vitals");
  const recordVitalsCard = document.getElementById("record-vitals-card");
  const recordVitalsForm = document.getElementById("record-vitals-form");
  const btnCancelRecordVitals = document.getElementById(
    "btn-cancel-record-vitals",
  );

  if (btnRecordVitals) {
    btnRecordVitals.addEventListener("click", () => {
      if (!dentalCurrentPatientId) return;
      recordVitalsCard.style.display = "block";
    });
  }

  if (btnCancelRecordVitals) {
    btnCancelRecordVitals.addEventListener("click", () => {
      recordVitalsCard.style.display = "none";
      recordVitalsForm.reset();
    });
  }

  if (recordVitalsForm) {
    recordVitalsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!dentalCurrentPatientId) return;

      const payload = {
        patient_id: dentalCurrentPatientId,
        date_recorded: document.getElementById("vitals_date").value,
        blood_pressure: document.getElementById("vitals_bp").value,
        heart_rate: document.getElementById("vitals_pulse").value,
        temperature: document.getElementById("vitals_temp").value,
        weight: document.getElementById("vitals_weight").value,
      };

      try {
        const res = await fetch("/api/patient-vitals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Failed to save vitals");
        }

        await loadDentalPatientRecord(dentalCurrentPatientId);
        recordVitalsForm.reset();
        recordVitalsCard.style.display = "none";
      } catch (err) {
        console.error(err);
        alert(err.message || "Failed to save vitals.");
      }
    });
  }
}

function billingToday() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function formatPeso(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  });
}

async function billingFetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || "Billing request failed.");
  }
  return data;
}

async function loadBillings() {
  const tbody = document.getElementById("billing-table-body");
  const message = document.getElementById("billing-list-message");
  if (!tbody) return;

  const q = document.getElementById("billing-search")?.value.trim() || "";
  const status = document.getElementById("billing-status-filter")?.value || "";
  tbody.innerHTML =
    '<tr><td colspan="9">Loading billing statements...</td></tr>';
  if (message) message.textContent = "";

  try {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const data = await billingFetchJson(`/api/billings?${params.toString()}`);
    const rows = data.billings || [];

    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="9">No billing statements found.</td></tr>';
      return;
    }

    tbody.innerHTML = rows
      .map(
        (row) => `
          <tr>
            <td>#${escapeHtml(row.billing_id)}</td>
            <td>${escapeHtml(row.patient_name)}</td>
            <td>${escapeHtml(row.billing_date)}</td>
            <td>${escapeHtml(row.treatment_name)}</td>
            <td>${escapeHtml(formatPeso(row.total_amount))}</td>
            <td>${escapeHtml(formatPeso(row.amount_paid))}</td>
            <td>${escapeHtml(formatPeso(row.balance))}</td>
            <td>${escapeHtml(row.billing_status)}</td>
            <td><button type="button" class="billing-view-button" data-billing-id="${escapeHtml(row.billing_id)}">View</button></td>
          </tr>`,
      )
      .join("");
  } catch (err) {
    console.error(err);
    tbody.innerHTML =
      '<tr><td colspan="9">Unable to load billing statements.</td></tr>';
    if (message) message.textContent = err.message;
  }
}

async function searchBillingPatients(query) {
  const results = document.getElementById("billing-patient-results");
  if (!results) return;
  results.innerHTML = "";
  document.getElementById("billing-patient-id").value = "";
  resetBillingTreatmentOptions("Select a patient first");

  if (query.trim().length < 2) return;

  try {
    const patients = await billingFetchJson(
      `/api/patients/search?q=${encodeURIComponent(query.trim())}`,
    );
    results.innerHTML = patients.length
      ? patients
          .map(
            (patient) =>
              `<option value="${escapeHtml(patient.patient_id)}">${escapeHtml(`${patient.first_name || ""} ${patient.last_name || ""}`.trim())}</option>`,
          )
          .join("")
      : '<option value="">No patients found</option>';
  } catch (err) {
    results.innerHTML = `<option value="">${escapeHtml(err.message)}</option>`;
  }
}

function resetBillingTreatmentOptions(message) {
  const select = document.getElementById("billing-treatment-select");
  if (!select) return;
  select.disabled = true;
  select.innerHTML = `<option value="">${escapeHtml(message)}</option>`;
  document.getElementById("billing-total-amount").value = "";
}

async function loadBillingTreatmentOptions(patientId) {
  const select = document.getElementById("billing-treatment-select");
  if (!select) return;
  resetBillingTreatmentOptions("Loading treatments...");

  try {
    const data = await billingFetchJson(
      `/api/billing/patients/${encodeURIComponent(patientId)}/treatments`,
    );
    const treatments = data.treatments || [];
    if (!treatments.length) {
      resetBillingTreatmentOptions("No unbilled treatments found");
      return;
    }

    select.disabled = false;
    select.innerHTML =
      '<option value="">Select treatment</option>' +
      treatments
        .map(
          (treatment) => `
            <option value="${escapeHtml(treatment.patient_treatment_id)}" data-price="${escapeHtml(treatment.actual_price)}">
              ${escapeHtml(treatment.treatment_name)} - ${escapeHtml(treatment.treatment_date)} - ${escapeHtml(formatPeso(treatment.actual_price))}
            </option>`,
        )
        .join("");
  } catch (err) {
    resetBillingTreatmentOptions(err.message);
  }
}

function renderBillingPaymentHistory(payments) {
  const tbody = document.getElementById("billing-payment-history");
  if (!tbody) return;
  if (!payments?.length) {
    tbody.innerHTML = '<tr><td colspan="7">No payments recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = payments
    .map(
      (payment) => `
        <tr>
          <td>${escapeHtml(payment.payment_date)}</td>
          <td>${escapeHtml(formatPeso(payment.amount_paid))}</td>
          <td>${escapeHtml(payment.payment_method)}</td>
          <td>${escapeHtml(payment.payment_status)}</td>
          <td>${escapeHtml(payment.reference_number || "-")}</td>
          <td>${escapeHtml(payment.recorded_by_name)}</td>
          <td>${escapeHtml(payment.notes || "-")}</td>
        </tr>`,
    )
    .join("");
}

async function openBillingStatement(billingId) {
  const dialog = document.getElementById("billing-view-dialog");
  const updateError = document.getElementById("billing-update-error");
  const paymentError = document.getElementById("billing-payment-error");
  if (!dialog) return;
  if (updateError) updateError.textContent = "";
  if (paymentError) paymentError.textContent = "";

  try {
    const data = await billingFetchJson(
      `/api/billings/${encodeURIComponent(billingId)}`,
    );
    const billing = data.billing;

    document.getElementById("billing-view-id").textContent =
      `#${billing.billing_id}`;
    document.getElementById("billing-view-patient").textContent =
      billing.patient_name;
    document.getElementById("billing-view-treatment").textContent =
      billing.treatment_name;
    document.getElementById("billing-view-paid").textContent = formatPeso(
      billing.amount_paid,
    );
    document.getElementById("billing-view-balance").textContent = formatPeso(
      billing.balance,
    );
    document.getElementById("billing-update-id").value = billing.billing_id;
    document.getElementById("billing-update-date").value = billing.billing_date;
    document.getElementById("billing-update-total").value = Number(
      billing.total_amount,
    ).toFixed(2);
    document.getElementById("billing-update-status").value =
      billing.billing_status;
    document.getElementById("billing-payment-date").value = billingToday();
    document.getElementById("billing-payment-amount").value = "";
    document.getElementById("billing-payment-method").value = "cash";
    document.getElementById("billing-payment-status").value = "completed";
    document.getElementById("billing-payment-billing-status").value =
      billing.billing_status;
    document.getElementById("billing-payment-reference").value = "";
    document.getElementById("billing-payment-notes").value = "";
    renderBillingPaymentHistory(data.payments || []);

    if (!dialog.open) dialog.showModal();
  } catch (err) {
    console.error(err);
    const message = document.getElementById("billing-list-message");
    if (message) message.textContent = err.message;
  }
}

function initBillingTab() {
  const search = document.getElementById("billing-search");
  const filter = document.getElementById("billing-status-filter");
  const tbody = document.getElementById("billing-table-body");
  const newButton = document.getElementById("billing-new-button");
  const newDialog = document.getElementById("billing-new-dialog");
  const newForm = document.getElementById("billing-new-form");
  const patientSearch = document.getElementById("billing-patient-search");
  const patientResults = document.getElementById("billing-patient-results");
  const treatmentSelect = document.getElementById("billing-treatment-select");
  const viewDialog = document.getElementById("billing-view-dialog");
  const updateForm = document.getElementById("billing-update-form");
  const paymentForm = document.getElementById("billing-payment-form");

  if (search) {
    search.addEventListener("input", debounce(loadBillings, 250));
  }
  if (filter) filter.addEventListener("change", loadBillings);
  if (tbody) {
    tbody.addEventListener("click", (event) => {
      const button = event.target.closest(".billing-view-button");
      if (button) openBillingStatement(button.dataset.billingId);
    });
  }

  if (newButton && newDialog) {
    newButton.addEventListener("click", () => {
      newForm.reset();
      document.getElementById("billing-patient-id").value = "";
      document.getElementById("billing-patient-results").innerHTML = "";
      document.getElementById("billing-date").value = billingToday();
      document.getElementById("billing-new-status").value = "unpaid";
      document.getElementById("billing-new-error").textContent = "";
      resetBillingTreatmentOptions("Select a patient first");
      newDialog.showModal();
    });
  }
  document
    .getElementById("billing-new-cancel")
    ?.addEventListener("click", () => {
      newDialog.close();
    });

  if (patientSearch) {
    patientSearch.addEventListener(
      "input",
      debounce((event) => searchBillingPatients(event.target.value), 250),
    );
  }
  if (patientResults) {
    patientResults.addEventListener("change", () => {
      const option = patientResults.selectedOptions[0];
      if (!option?.value) return;
      document.getElementById("billing-patient-id").value = option.value;
      patientSearch.value = option.textContent.trim();
      loadBillingTreatmentOptions(option.value);
    });
  }
  if (treatmentSelect) {
    treatmentSelect.addEventListener("change", () => {
      const option = treatmentSelect.selectedOptions[0];
      document.getElementById("billing-total-amount").value = option?.dataset
        .price
        ? Number(option.dataset.price).toFixed(2)
        : "";
    });
  }

  if (newForm) {
    newForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = document.getElementById("billing-new-error");
      error.textContent = "";
      const patientId = document.getElementById("billing-patient-id").value;
      if (!patientId) {
        error.textContent =
          "Please choose a patient from the matching patients list.";
        return;
      }

      try {
        await billingFetchJson("/api/billings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_treatment_id: treatmentSelect.value,
            billing_date: document.getElementById("billing-date").value,
            total_amount: document.getElementById("billing-total-amount").value,
            billing_status: document.getElementById("billing-new-status").value,
          }),
        });
        newDialog.close();
        await loadBillings();
      } catch (err) {
        error.textContent = err.message;
      }
    });
  }

  if (updateForm) {
    updateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = document.getElementById("billing-update-error");
      const billingId = document.getElementById("billing-update-id").value;
      error.textContent = "";
      try {
        await billingFetchJson(
          `/api/billings/${encodeURIComponent(billingId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              billing_date: document.getElementById("billing-update-date")
                .value,
              total_amount: document.getElementById("billing-update-total")
                .value,
              billing_status: document.getElementById("billing-update-status")
                .value,
            }),
          },
        );
        await openBillingStatement(billingId);
        await loadBillings();
      } catch (err) {
        error.textContent = err.message;
      }
    });
  }

  if (paymentForm) {
    paymentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const error = document.getElementById("billing-payment-error");
      const billingId = document.getElementById("billing-update-id").value;
      error.textContent = "";
      try {
        await billingFetchJson(
          `/api/billings/${encodeURIComponent(billingId)}/payments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payment_date: document.getElementById("billing-payment-date")
                .value,
              amount_paid: document.getElementById("billing-payment-amount")
                .value,
              payment_method: document.getElementById("billing-payment-method")
                .value,
              payment_status: document.getElementById("billing-payment-status")
                .value,
              billing_status: document.getElementById(
                "billing-payment-billing-status",
              ).value,
              reference_number: document.getElementById(
                "billing-payment-reference",
              ).value,
              notes: document.getElementById("billing-payment-notes").value,
            }),
          },
        );
        await openBillingStatement(billingId);
        await loadBillings();
      } catch (err) {
        error.textContent = err.message;
      }
    });
  }

  document
    .getElementById("billing-view-close")
    ?.addEventListener("click", () => {
      viewDialog.close();
    });
}
