const ROLE_TABS = Object.freeze({
  superadmin: new Set([
    "dashboard",
    "view-appointments",
    "set-schedules",
    "patient-info",
    "patient-status",
    "archived-patients",
    "dental-records",
    "reports",
    "billing",
    "audit-logs",
    "doctor-profiles",
  ]),
  doctor: new Set([
    "dashboard",
    "view-appointments",
    "set-schedules",
    "patient-info",
    "patient-status",
    "dental-records",
    "reports",
    "audit-logs",
  ]),
  staff: new Set([
    "dashboard",
    "view-appointments",
    "set-schedules",
    "patient-info",
    "patient-status",
    "reports",
    "billing",
    "audit-logs",
  ]),
});

let managementRole = null;
const SCHEDULE_WEEKDAYS = Object.freeze([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

const REPORT_CONFIG = Object.freeze({
  appointments: {
    endpoint: "/api/reports/appointments",
    title: "Appointment Report",
    description: "Results are sorted by appointment date and time.",
    columns: [
      { key: "appointment_id", label: "ID" },
      { key: "appointment_date", label: "Date", format: "date" },
      { key: "appointment_time", label: "Time" },
      { key: "patient_name", label: "Patient" },
      { key: "doctor_name", label: "Doctor" },
      { key: "appointment_type", label: "Booked Type", format: "label" },
      { key: "service_availed", label: "Service Availed" },
      { key: "appointment_status", label: "Status", format: "status" },
      { key: "reason_for_visit", label: "Reason" },
    ],
  },
  patients: {
    endpoint: "/api/reports/patients",
    title: "Patient Report",
    description: "Results are sorted by registration date and patient name.",
    columns: [
      { key: "patient_id", label: "Patient ID" },
      { key: "patient_name", label: "Patient" },
      { key: "email", label: "Email" },
      { key: "contact_number", label: "Contact" },
      { key: "date_registered", label: "Registered", format: "date" },
      { key: "patient_status", label: "Status", format: "status" },
      { key: "last_appointment", label: "Last Appointment", format: "dateOrText" },
      { key: "appointment_count", label: "Appointments" },
    ],
  },
  treatments: {
    endpoint: "/api/reports/treatments",
    title: "Treatment Report",
    description: "Results are sorted by visit date and patient name.",
    columns: [
      { key: "visit_date", label: "Visit Date", format: "date" },
      { key: "patient_name", label: "Patient" },
      { key: "doctor_name", label: "Doctor" },
      { key: "treatment_name", label: "Treatment" },
      { key: "category", label: "Category" },
      { key: "teeth_involved", label: "Teeth" },
      { key: "actual_duration", label: "Duration", format: "minutes" },
      { key: "actual_price", label: "Price", format: "currency" },
    ],
  },
  billing: {
    endpoint: "/api/reports/billing",
    title: "Billing Report",
    description: "Results are sorted by billing date and statement ID.",
    columns: [
      { key: "billing_id", label: "Billing ID" },
      { key: "billing_date", label: "Date", format: "date" },
      { key: "patient_name", label: "Patient" },
      { key: "treatment_name", label: "Treatment" },
      { key: "total_amount", label: "Total", format: "currency" },
      { key: "amount_paid", label: "Paid", format: "currency" },
      { key: "balance", label: "Balance", format: "currency" },
      { key: "billing_status", label: "Status", format: "status" },
    ],
  },
});

let selectedReportType = "appointments";
let reportCurrentPage = 1;
let reportTotalPages = 1;
let reportLastQuery = new URLSearchParams();

function normalizeManagementRole(role) {
  return role === "admin" ? "superadmin" : role;
}

function roleDisplayName(role) {
  if (role === "superadmin") return "Superadmin";
  if (role === "doctor") return "Doctor";
  if (role === "staff") return "Staff";
  return "Management";
}

function showTab(name) {
  if (!managementRole || !ROLE_TABS[managementRole]?.has(name)) return;
  document
    .querySelectorAll(".content > div")
    .forEach((el) => (el.style.display = "none"));
  const tab = document.getElementById("tab-" + name);
  if (tab) tab.style.display = "block";
  if (name === "billing") loadBillings();
  if (name === "audit-logs") loadAuditLogs();
  if (name === "doctor-profiles") loadDoctorStaffSummaries();
  if (name === "set-schedules") configureScheduleInterface();
  if (name === "patient-info") loadPatientDirectory("info", 1);
  if (name === "patient-status") loadPatientDirectory("status", 1);
  if (name === "archived-patients") loadArchivedPatients(1);
  if (name === "dental-records") loadPatientDirectory("dental", 1);
}

function configureScheduleInterface() {
  const isDoctor = managementRole === "doctor";
  const isStaff = managementRole === "staff";
  const appointmentButton = document.getElementById("btn-show-add");
  const doctorHoursButton = document.getElementById("btn-show-cancel");
  const staffShiftButton = document.getElementById("btn-show-staff-shift");
  const emergencyDoctorButton = document.getElementById(
    "btn-show-emergency-doctor",
  );
  const appointmentCard = document.getElementById("appointment-form-card");
  const doctorHoursCard = document.getElementById("clinic-hours-form-card");
  const staffShiftCard = document.getElementById("staff-shift-form-card");
  const emergencyDoctorCard = document.getElementById(
    "emergency-doctor-form-card",
  );
  const dentistField = document.getElementById("clinic-dentist-field");
  const heading = document.getElementById("clinic-hours-heading");
  const description = document.getElementById("clinic-hours-description");
  const tabDescription = document.getElementById("schedule-tab-description");
  const currentScheduleSection = document.getElementById(
    "doctor-current-schedule-section",
  );

  if (appointmentButton) appointmentButton.hidden = false;
  if (doctorHoursButton) doctorHoursButton.hidden = isStaff;
  if (staffShiftButton) staffShiftButton.hidden = !isStaff;
  if (emergencyDoctorButton) {
    emergencyDoctorButton.hidden = managementRole !== "superadmin";
  }
  if (dentistField) dentistField.hidden = isDoctor;
  if (currentScheduleSection) currentScheduleSection.hidden = !isDoctor;

  if (isDoctor) {
    if (heading) heading.textContent = "My Clinic Hours";
    if (description) {
      description.textContent =
        "Select one or more regular days and apply the same availability hours to all of them.";
    }
    if (tabDescription) {
      tabDescription.textContent =
        "Add patient appointments or manage your own appointment availability.";
    }
    if (appointmentCard) appointmentCard.style.display = "none";
    if (doctorHoursCard) doctorHoursCard.style.display = "block";
    if (staffShiftCard) staffShiftCard.style.display = "none";
    if (emergencyDoctorCard) emergencyDoctorCard.style.display = "none";
    loadDoctorCurrentSchedule();
    return;
  }

  if (heading) heading.textContent = "Doctor Availability";
  if (description) {
    description.textContent =
      "Select one or more regular days and apply the same availability hours to all of them.";
  }
  if (tabDescription) {
    tabDescription.textContent = isStaff
      ? "Add appointments or update your own staff shift schedule."
      : "Add appointments or adjust doctor availability.";
  }
  if (doctorHoursCard) doctorHoursCard.style.display = "none";
  if (staffShiftCard) staffShiftCard.style.display = "none";
  if (emergencyDoctorCard) emergencyDoctorCard.style.display = "none";
}

async function initializeRoleInterface() {
  try {
    const response = await fetch("/api/me");
    if (!response.ok) throw new Error("Unable to load your account.");
    const user = await response.json();
    managementRole = normalizeManagementRole(user.role);
    const allowedTabs = ROLE_TABS[managementRole];
    if (!allowedTabs) {
      window.location.replace("/patientPage.html");
      return;
    }

    if (managementRole !== "staff") {
      document.getElementById("btn-show-staff-shift")?.remove();
      document.getElementById("staff-shift-form-card")?.remove();
    }

    if (managementRole === "staff") {
      document.getElementById("btn-show-cancel")?.remove();
      document.getElementById("clinic-hours-form-card")?.remove();
    }

    if (managementRole !== "superadmin") {
      document.getElementById("btn-show-emergency-doctor")?.remove();
      document.getElementById("emergency-doctor-form-card")?.remove();
    }

    document.body.dataset.role = managementRole;
    configureReportAccess();
    document.querySelectorAll(".sidebar a[data-roles]").forEach((link) => {
      const allowedRoles = (link.dataset.roles || "").split(/\s+/);
      link.closest("li").hidden = !allowedRoles.includes(managementRole);
    });
    document.querySelectorAll(".sidebar .section-label").forEach((label) => {
      const list = label.nextElementSibling;
      const hasVisibleLink = list && [...list.querySelectorAll("li")].some(
        (item) => !item.hidden,
      );
      label.hidden = !hasVisibleLink;
      if (list) list.hidden = !hasVisibleLink;
    });

    const displayRole = roleDisplayName(managementRole);
    const portalLabel = document.getElementById("portal-role-label");
    if (portalLabel) portalLabel.textContent = displayRole;
    document.title = `${displayRole} Dashboard - PurplePoint`;
    const now = new Date();
    document.getElementById("welcome-date").textContent =
      `Welcome back, ${displayRole}. ` +
      now.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });

    showTab("dashboard");
    await Promise.all([loadStats(), loadSchedule()]);
  } catch (error) {
    console.error(error);
    window.location.replace("/login.html");
  }
}

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
          <td>${escapeHtml(row.time)}</td>
          <td>${escapeHtml(row.patient)}</td>
          <td>${escapeHtml(row.doctor_name || "--")}</td>
          <td>${escapeHtml(row.reason)}</td>
          <td><span class="badge">${escapeHtml(String(row.status || "").toUpperCase())}</span></td>
        </tr>`,
      )
      .join("");
  } catch (err) {
    console.error(err);
    tbody.innerHTML = "<tr><td colspan='5'>Failed to load schedule.</td></tr>";
  }
}

async function signOut() {
  const button = document.getElementById("sign-out-button");
  if (button) {
    button.disabled = true;
    button.textContent = "Signing Out...";
  }
  try {
    const response = await fetch("/api/logout", { method: "POST" });
    if (!response.ok) throw new Error("Sign out failed");
    window.location.replace("/login.html");
  } catch (error) {
    console.error(error);
    if (button) {
      button.disabled = false;
      button.textContent = "Try Sign Out Again";
      button.title = "PurplePoint could not sign you out. Please try again.";
    }
  }
}

initializeRoleInterface();

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
        <button type="button" id="admin-cal-prev" class="appointment-calendar-nav"
          aria-label="Previous month" title="Previous month">&lt;</button>
        <strong style="font-size:15px;">${monthLabel}</strong>
        <button type="button" id="admin-cal-next" class="appointment-calendar-nav"
          aria-label="Next month" title="Next month">&gt;</button>
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
        const rawStatus = String(
          appt.appointment_status || "",
        ).toLowerCase();
        const status = [
          "scheduled",
          "completed",
          "cancelled",
          "no_show",
        ].includes(rawStatus)
          ? rawStatus
          : "scheduled";

        const tag = document.createElement("div");
        tag.className = `appointment-calendar-event appointment-calendar-event--${status}`;
        tag.style.cssText =
          "font-size:11px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:3px;padding:2px 5px;cursor:pointer;";
        tag.textContent = `${name} — ${time}`;
        const statusLabel = status === "no_show" ? "late / no show" : status;
        const cancellationDetails =
          status === "cancelled" && appt.cancel_reason
            ? ` — Reason: ${appt.cancel_reason}`
            : "";
        tag.title = `${name} — ${time} — ${statusLabel}${cancellationDetails} (click to update status)`;
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
    container.textContent = `Error: ${err.message}`;
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
  const statuses = ["scheduled", "completed", "cancelled", "no_show"];

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
              `<option value="${s}" ${s === currentStatus ? "selected" : ""}>${s === "no_show" ? "Late / No Show" : s.charAt(0).toUpperCase() + s.slice(1)}</option>`,
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

  reasonInput.value = appt.cancel_reason || "";

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
        `<div class="suggestion-item" data-user-id="${escapeHtml(user.user_id)}">${escapeHtml(formatUserLabel(user))}</div>`,
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
        `<div class="suggestion-item" data-patient-id="${escapeHtml(p.patient_id)}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)} · ${escapeHtml(p.email || p.contact_number || "")}</div>`,
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
        `<div class="suggestion-item" data-patient-id="${escapeHtml(p.patient_id)}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)} · ${escapeHtml(p.email || p.contact_number || "")}</div>`,
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
  box.innerHTML = `
    <form id="patient-information-edit-form" data-patient-id="${escapeHtml(patient.patient_id)}">
      <h3 style="margin-top:0;">Edit ${escapeHtml(fullName || "Patient")}</h3>
      <p class="muted-copy">
        Identity and medical identity fields are locked. Use Patient Status to
        update the patient's active or inactive status.
      </p>
      <div class="row">
        <div class="field">
          <label for="patient-edit-first-name">First name</label>
          <input id="patient-edit-first-name" value="${escapeHtml(patient.first_name || "")}" readonly />
        </div>
        <div class="field">
          <label for="patient-edit-last-name">Last name</label>
          <input id="patient-edit-last-name" value="${escapeHtml(patient.last_name || "")}" readonly />
        </div>
        <div class="field">
          <label for="patient-edit-email">Email</label>
          <input id="patient-edit-email" name="email" type="email" maxlength="100" value="${escapeHtml(patient.email || "")}" required />
        </div>
        <div class="field">
          <label for="patient-edit-date-of-birth">Date of birth</label>
          <input id="patient-edit-date-of-birth" value="${escapeHtml(dob)}" readonly />
        </div>
        <div class="field">
          <label for="patient-edit-gender">Sex</label>
          <input id="patient-edit-gender" value="${escapeHtml(patient.gender || "")}" readonly />
        </div>
        <div class="field">
          <label for="patient-edit-blood-type">Blood type</label>
          <input id="patient-edit-blood-type" value="${escapeHtml(patient.blood_type || "")}" readonly />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label for="patient-edit-contact-number">Contact number</label>
          <input id="patient-edit-contact-number" name="contact_number" type="tel" maxlength="20" value="${escapeHtml(patient.contact_number || "")}" required />
        </div>
        <div class="field">
          <label for="patient-edit-house-no">House number</label>
          <input id="patient-edit-house-no" name="house_no" maxlength="20" value="${escapeHtml(patient.house_no || "")}" required />
        </div>
        <div class="field">
          <label for="patient-edit-street">Street</label>
          <input id="patient-edit-street" name="street" maxlength="255" value="${escapeHtml(patient.street || "")}" required />
        </div>
        <div class="field">
          <label for="patient-edit-barangay">Barangay</label>
          <input id="patient-edit-barangay" name="barangay" maxlength="100" value="${escapeHtml(patient.barangay || "")}" required />
        </div>
        <div class="field">
          <label for="patient-edit-city">City</label>
          <input id="patient-edit-city" name="city" maxlength="100" value="${escapeHtml(patient.city || "")}" required />
        </div>
        <div class="field">
          <label for="patient-edit-zip-code">ZIP code</label>
          <input id="patient-edit-zip-code" name="zip_code" maxlength="20" value="${escapeHtml(patient.zip_code || "")}" required />
        </div>
        <div class="field">
          <label for="patient-edit-emergency-name">Emergency contact name</label>
          <input id="patient-edit-emergency-name" name="emergency_contact_name" maxlength="150" value="${escapeHtml(patient.emergency_contact_name || "")}" required />
        </div>
        <div class="field">
          <label for="patient-edit-emergency-number">Emergency contact number</label>
          <input id="patient-edit-emergency-number" name="emergency_contact_number" type="tel" maxlength="20" value="${escapeHtml(patient.emergency_contact_number || "")}" required />
        </div>
        <div class="field">
          <label for="patient-edit-diabetes-status">Diabetic status</label>
          <select id="patient-edit-diabetes-status" name="diabetes_status" required>
            <option value="unknown" ${patient.diabetes_status === "unknown" ? "selected" : ""}>Unknown</option>
            <option value="no" ${patient.diabetes_status === "no" ? "selected" : ""}>No</option>
            <option value="yes" ${patient.diabetes_status === "yes" ? "selected" : ""}>Yes</option>
          </select>
        </div>
        <div class="field">
          <label for="patient-edit-allergies">Allergies</label>
          <textarea id="patient-edit-allergies" name="allergies" maxlength="7600" placeholder="Enter one allergy per line, or leave blank if none are known">${escapeHtml(Array.isArray(patient.allergies) ? patient.allergies.join("\n") : "")}</textarea>
        </div>
      </div>

      <p>
        <strong>Status:</strong> ${escapeHtml(patient.patient_status || "active")}
        &nbsp;|&nbsp; <strong>Date registered:</strong> ${escapeHtml(patient.date_registered || "Not provided")}
        &nbsp;|&nbsp; <strong>Appointments:</strong> ${escapeHtml(String(patient.appointment_count || 0))}
      </p>
      <button type="submit">Save Patient Information</button>
      <div id="patient-information-edit-result" class="result" role="status"></div>
    </form>
  `;

  box
    .querySelector("#patient-information-edit-form")
    ?.addEventListener("submit", submitPatientInformationEdit);
}

async function submitPatientInformationEdit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const patientId = form.dataset.patientId;
  const result = document.getElementById("patient-information-edit-result");
  const button = form.querySelector('button[type="submit"]');
  const payload = Object.fromEntries(new FormData(form).entries());

  result.textContent = "Saving patient information...";
  result.classList.remove("error", "success");
  button.disabled = true;
  try {
    const response = await fetch(
      `/api/patients/${encodeURIComponent(patientId)}/information`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to save patient information.");
    }
    result.textContent = "Patient information saved successfully.";
    result.classList.add("success");
    loadPatientDirectory("info", patientDirectoryState.info.page);
  } catch (error) {
    result.textContent = error.message;
    result.classList.add("error");
  } finally {
    button.disabled = false;
  }
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
        `<div class="suggestion-item" data-dentist-id="${escapeHtml(d.dentist_id)}">${escapeHtml(d.first_name)} ${escapeHtml(d.last_name)} · ${escapeHtml(d.specialization || d.email || "")}${d.license_number ? ` · License: ${escapeHtml(d.license_number)}` : ""}</div>`,
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

async function searchPatientStatus(query) {
  const suggestions = document.getElementById("patient-status-suggestions");
  if (!suggestions) return;
  if (!query || query.trim().length < 1) {
    suggestions.innerHTML = "";
    return;
  }

  try {
    const response = await fetch(
      `/api/patients/search?q=${encodeURIComponent(query)}`,
    );
    if (!response.ok) throw new Error("Search failed");
    const patients = await response.json();
    suggestions.innerHTML = patients.length
      ? patients
          .map(
            (patient) => `
              <button type="button" class="suggestion-item patient-status-option"
                data-patient-id="${escapeHtml(patient.patient_id)}"
                data-patient-name="${escapeHtml(`${patient.first_name || ""} ${patient.last_name || ""}`.trim())}"
                style="display:block;width:100%;text-align:left;border:0;border-radius:0;background:#fff;color:inherit;box-shadow:none;transform:none;">
                ${escapeHtml(`${patient.first_name || ""} ${patient.last_name || ""}`.trim())}
                <small style="display:block;color:#777;">${escapeHtml(patient.email || patient.contact_number || "")}</small>
              </button>`,
          )
          .join("")
      : '<div style="padding:10px;color:#666;">No patients found.</div>';
  } catch (error) {
    console.error(error);
    suggestions.innerHTML =
      '<div style="padding:10px;color:#b42318;">Unable to search patients.</div>';
  }
}

async function loadPatientStatus(patientId) {
  const card = document.getElementById("patient-status-editor-card");
  const editor = document.getElementById("patient-status-editor");
  const message = document.getElementById("patient-status-message");
  if (!card || !editor || !message) return;
  card.hidden = false;
  editor.style.display = "none";
  message.textContent = "Loading patient status...";
  message.classList.remove("error", "success");

  try {
    const response = await fetch(
      `/api/patients/${encodeURIComponent(patientId)}/status`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to load patient status.");
    }

    document.getElementById("patient-status-id").value =
      data.patient.patient_id;
    document.getElementById("patient-status-name").textContent =
      data.patient.patient_name;
    document.getElementById("patient-status-value").value =
      data.patient.patient_status || "active";
    editor.style.display = "block";
    message.textContent = data.patient.patient_records_id
      ? ""
      : "This patient must complete their profile before status can be changed.";
    if (!data.patient.patient_records_id) message.classList.add("error");
    document.getElementById("patient-status-save").disabled =
      !data.patient.patient_records_id;
    const archiveButton = document.getElementById("patient-archive-button");
    if (archiveButton) {
      archiveButton.hidden =
        managementRole !== "superadmin" ||
        !data.patient.patient_records_id ||
        data.patient.patient_status === "archived";
      archiveButton.dataset.patientId = data.patient.patient_id;
      archiveButton.dataset.patientName = data.patient.patient_name;
    }
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  }
}

async function savePatientStatus() {
  const patientId = document.getElementById("patient-status-id")?.value;
  const patientStatus = document.getElementById("patient-status-value")?.value;
  const button = document.getElementById("patient-status-save");
  const message = document.getElementById("patient-status-message");
  if (!patientId || !patientStatus || !button || !message) return;

  button.disabled = true;
  message.textContent = "Saving status...";
  message.classList.remove("error", "success");
  try {
    const response = await fetch(
      `/api/patients/${encodeURIComponent(patientId)}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_status: patientStatus }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to update patient status.");
    }
    message.textContent = "Patient status updated successfully.";
    message.classList.add("success");
    loadPatientDirectory("status", patientDirectoryState.status.page);
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    button.disabled = false;
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

const PATIENT_DIRECTORY_CONFIG = Object.freeze({
  info: Object.freeze({
    prefix: "patient-info",
    columns: 8,
    filters: Object.freeze({
      search: "patient-info-search",
      status: "patient-info-status-filter",
      gender: "patient-info-gender-filter",
      profile: "patient-info-profile-filter",
    }),
  }),
  status: Object.freeze({
    prefix: "patient-status",
    columns: 7,
    filters: Object.freeze({
      search: "patient-status-search",
      status: "patient-status-status-filter",
      profile: "patient-status-profile-filter",
    }),
  }),
  dental: Object.freeze({
    prefix: "dental",
    columns: 7,
    filters: Object.freeze({
      search: "dental-patient-search",
      status: "dental-status-filter",
      records: "dental-records-filter",
      last_visit_from: "dental-last-visit-from",
      last_visit_to: "dental-last-visit-to",
    }),
  }),
});

const patientDirectoryState = {
  info: { page: 1, pages: 1, requestId: 0 },
  status: { page: 1, pages: 1, requestId: 0 },
  dental: { page: 1, pages: 1, requestId: 0 },
};

function patientDirectoryLabel(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : "—";
}

function patientDirectoryName(patient) {
  return (
    `${patient.first_name || ""} ${patient.last_name || ""}`.trim() ||
    `Patient #${patient.patient_id}`
  );
}

function renderPatientDirectoryRows(scope, patients) {
  if (!patients.length) return "";
  if (scope === "info") {
    return patients
      .map(
        (patient) => `
          <tr>
            <td>P-${escapeHtml(String(patient.patient_id).padStart(3, "0"))}</td>
            <td>${escapeHtml(patientDirectoryName(patient))}</td>
            <td>${escapeHtml(patient.email || "—")}</td>
            <td>${escapeHtml(patient.contact_number || "—")}</td>
            <td>${escapeHtml(patientDirectoryLabel(patient.gender))}</td>
            <td>${escapeHtml(patientDirectoryLabel(patient.patient_status))}</td>
            <td>${Number(patient.profile_complete) === 1 ? "Complete" : "Incomplete"}</td>
            <td><button type="button" class="patient-directory-view-button" data-directory-scope="info" data-patient-id="${escapeHtml(patient.patient_id)}">View/Edit</button></td>
          </tr>`,
      )
      .join("");
  }
  if (scope === "status") {
    return patients
      .map(
        (patient) => `
          <tr>
            <td>P-${escapeHtml(String(patient.patient_id).padStart(3, "0"))}</td>
            <td>${escapeHtml(patientDirectoryName(patient))}</td>
            <td>${escapeHtml(patient.email || "—")}</td>
            <td>${escapeHtml(patient.contact_number || "—")}</td>
            <td>${escapeHtml(patientDirectoryLabel(patient.patient_status))}</td>
            <td>${Number(patient.profile_complete) === 1 ? "Complete" : "Incomplete"}</td>
            <td><button type="button" class="patient-directory-view-button" data-directory-scope="status" data-patient-id="${escapeHtml(patient.patient_id)}">Manage Status</button></td>
          </tr>`,
      )
      .join("");
  }
  return patients
    .map(
      (patient) => `
        <tr>
          <td>P-${escapeHtml(String(patient.patient_id).padStart(3, "0"))}</td>
          <td>${escapeHtml(patientDirectoryName(patient))}</td>
          <td>${escapeHtml(patientDirectoryLabel(patient.patient_status))}</td>
          <td>${escapeHtml(patient.blood_type || "—")}</td>
          <td>${escapeHtml(patient.dental_record_count || 0)}</td>
          <td>${escapeHtml(patient.last_visit_date ? formatDentalDate(patient.last_visit_date) : "No visits")}</td>
          <td><button type="button" class="patient-directory-view-button" data-directory-scope="dental" data-patient-id="${escapeHtml(patient.patient_id)}">View Records</button></td>
        </tr>`,
    )
    .join("");
}

async function loadPatientDirectory(scope, page = 1) {
  const config = PATIENT_DIRECTORY_CONFIG[scope];
  const state = patientDirectoryState[scope];
  if (!config || !state) return;
  if (scope === "dental" && managementRole === "staff") return;

  const tbody = document.getElementById(`${config.prefix}-table-body`);
  const message = document.getElementById(`${config.prefix}-list-message`);
  if (!tbody) return;

  state.page = Math.max(1, page);
  const requestId = ++state.requestId;
  tbody.innerHTML = `<tr><td colspan="${config.columns}">Loading patients...</td></tr>`;
  if (message) message.textContent = "";

  const params = new URLSearchParams({
    scope,
    page: String(state.page),
    limit: "8",
  });
  Object.entries(config.filters).forEach(([queryKey, elementId]) => {
    const value = document.getElementById(elementId)?.value.trim();
    if (value) params.set(queryKey, value);
  });

  try {
    const response = await fetch(
      `/api/patients/directory?${params.toString()}`,
    );
    const data = await response.json().catch(() => ({}));
    if (requestId !== state.requestId) return;
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to load patients.");
    }

    const patients = data.patients || [];
    state.page = data.pagination?.page || 1;
    state.pages = data.pagination?.pages || 1;
    tbody.innerHTML = patients.length
      ? renderPatientDirectoryRows(scope, patients)
      : `<tr><td colspan="${config.columns}">No patients found.</td></tr>`;

    const summary = document.getElementById(
      `${config.prefix}-pagination-summary`,
    );
    if (summary) {
      summary.textContent = `Page ${state.page} of ${state.pages} | ${data.pagination?.total || 0} patients`;
    }
    const previous = document.getElementById(
      `${config.prefix}-previous-page`,
    );
    const next = document.getElementById(`${config.prefix}-next-page`);
    if (previous) previous.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= state.pages;
  } catch (error) {
    if (requestId !== state.requestId) return;
    tbody.innerHTML = `<tr><td colspan="${config.columns}">Unable to load patients.</td></tr>`;
    if (message) message.textContent = error.message;
  }
}

function openPatientDirectoryDetails(scope, patientId) {
  if (scope === "info") {
    loadPatientInfoDetails(patientId).then(() => {
      document.getElementById("patient-info-details")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  } else if (scope === "status") {
    loadPatientStatus(patientId).then(() => {
      document.getElementById("patient-status-editor-card")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  } else if (scope === "dental") {
    loadDentalPatientRecord(patientId).then(() => {
      document.getElementById("dental-record-card")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }
}

function initPatientDirectories() {
  Object.entries(PATIENT_DIRECTORY_CONFIG).forEach(([scope, config]) => {
    const state = patientDirectoryState[scope];
    const searchInput = document.getElementById(config.filters.search);
    searchInput?.addEventListener(
      "input",
      debounce(() => loadPatientDirectory(scope, 1), 250),
    );
    searchInput?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") loadPatientDirectory(scope, 1);
    });
    document
      .getElementById(`${config.prefix}-apply-filters`)
      ?.addEventListener("click", () => {
        loadPatientDirectory(scope, 1);
        document
          .getElementById(`${config.prefix}-filter-panel`)
          ?.removeAttribute("open");
      });
    document
      .getElementById(`${config.prefix}-reset-filters`)
      ?.addEventListener("click", () => {
        Object.values(config.filters).forEach((elementId) => {
          const element = document.getElementById(elementId);
          if (element) element.value = "";
        });
        loadPatientDirectory(scope, 1);
        document
          .getElementById(`${config.prefix}-filter-panel`)
          ?.removeAttribute("open");
      });
    document
      .getElementById(`${config.prefix}-previous-page`)
      ?.addEventListener("click", () => {
        if (state.page > 1) loadPatientDirectory(scope, state.page - 1);
      });
    document
      .getElementById(`${config.prefix}-next-page`)
      ?.addEventListener("click", () => {
        if (state.page < state.pages) {
          loadPatientDirectory(scope, state.page + 1);
        }
      });
    document
      .getElementById(`${config.prefix}-table-body`)
      ?.addEventListener("click", (event) => {
        const button = event.target.closest(".patient-directory-view-button");
        if (button) {
          openPatientDirectoryDetails(
            button.dataset.directoryScope,
            button.dataset.patientId,
          );
        }
      });
  });
}

const archivedPatientState = {
  page: 1,
  pages: 1,
  requestId: 0,
};

function archivedPatientDateTime(value) {
  if (!value) return "—";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderArchivedPatientRows(patients) {
  return patients
    .map(
      (patient) => `
        <tr>
          <td>P-${escapeHtml(String(patient.patient_id).padStart(3, "0"))}</td>
          <td>
            <strong>${escapeHtml(patient.patient_name || `Patient #${patient.patient_id}`)}</strong><br />
            <small>${escapeHtml(patient.email || "—")}</small>
          </td>
          <td>${escapeHtml(patient.contact_number || "—")}</td>
          <td>${escapeHtml(patientDirectoryLabel(patient.status_before_archive))}</td>
          <td>${escapeHtml(archivedPatientDateTime(patient.archived_at))}</td>
          <td>${escapeHtml(patient.archived_by_name || "Unknown user")}</td>
          <td>${escapeHtml(patient.archive_reason || "—")}</td>
          <td>${escapeHtml(patient.appointment_count || 0)}</td>
          <td>${escapeHtml(patient.dental_record_count || 0)}</td>
          <td>${escapeHtml(patient.billing_count || 0)}</td>
          <td>
            <button
              type="button"
              class="patient-restore-button"
              data-patient-id="${escapeHtml(patient.patient_id)}"
              data-patient-name="${escapeHtml(patient.patient_name || `Patient #${patient.patient_id}`)}"
            >
              Restore
            </button>
          </td>
        </tr>`,
    )
    .join("");
}

async function loadArchivedPatients(page = 1) {
  if (managementRole !== "superadmin") return;
  const tbody = document.getElementById("archive-patient-table-body");
  const message = document.getElementById("archive-patient-list-message");
  if (!tbody) return;

  archivedPatientState.page = Math.max(1, page);
  const requestId = ++archivedPatientState.requestId;
  const params = new URLSearchParams({
    page: String(archivedPatientState.page),
    limit: "8",
  });
  const filters = {
    search: "archive-patient-search",
    date_from: "archive-patient-date-from",
    date_to: "archive-patient-date-to",
  };
  Object.entries(filters).forEach(([key, id]) => {
    const value = document.getElementById(id)?.value.trim();
    if (value) params.set(key, value);
  });

  tbody.innerHTML = '<tr><td colspan="11">Loading archived patients...</td></tr>';
  if (message) message.textContent = "";
  try {
    const response = await fetch(`/api/archives/patients?${params.toString()}`);
    const data = await response.json().catch(() => ({}));
    if (requestId !== archivedPatientState.requestId) return;
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to load archived patients.");
    }
    const patients = data.patients || [];
    archivedPatientState.page = Number(data.pagination?.page || 1);
    archivedPatientState.pages = Number(data.pagination?.pages || 1);
    tbody.innerHTML = patients.length
      ? renderArchivedPatientRows(patients)
      : '<tr><td colspan="11">No archived patients found.</td></tr>';

    const total = Number(data.pagination?.total || 0);
    document.getElementById(
      "archive-patient-pagination-summary",
    ).textContent =
      `Page ${archivedPatientState.page} of ${archivedPatientState.pages} | ` +
      `${total} archived ${total === 1 ? "patient" : "patients"}`;
    document.getElementById("archive-patient-previous-page").disabled =
      archivedPatientState.page <= 1;
    document.getElementById("archive-patient-next-page").disabled =
      archivedPatientState.page >= archivedPatientState.pages;
  } catch (error) {
    if (requestId !== archivedPatientState.requestId) return;
    tbody.innerHTML = '<tr><td colspan="11">Unable to load archived patients.</td></tr>';
    if (message) message.textContent = error.message;
  }
}

function openPatientArchiveDialog(patientId, patientName) {
  const dialog = document.getElementById("patient-archive-dialog");
  if (!dialog || managementRole !== "superadmin") return;
  document.getElementById("patient-archive-id").value = patientId;
  document.getElementById("patient-archive-name").textContent = patientName;
  document.getElementById("patient-archive-reason").value = "";
  document.getElementById("patient-archive-message").textContent = "";
  if (!dialog.open) dialog.showModal();
  document.getElementById("patient-archive-reason").focus();
}

async function submitPatientArchive(event) {
  event.preventDefault();
  const patientId = document.getElementById("patient-archive-id")?.value;
  const reason = document.getElementById("patient-archive-reason")?.value.trim();
  const button = document.getElementById("patient-archive-confirm");
  const message = document.getElementById("patient-archive-message");
  if (!patientId || !reason || !button || !message) return;

  button.disabled = true;
  message.textContent = "Archiving patient...";
  message.classList.remove("error", "success");
  try {
    const response = await fetch(
      `/api/patients/${encodeURIComponent(patientId)}/archive`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to archive patient.");
    }
    document.getElementById("patient-archive-dialog").close();
    document.getElementById("patient-status-editor-card").hidden = true;
    await loadPatientDirectory("status", patientDirectoryState.status.page);
    const listMessage = document.getElementById("patient-status-list-message");
    if (listMessage) listMessage.textContent = data.message;
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    button.disabled = false;
  }
}

function openPatientRestoreDialog(patientId, patientName) {
  const dialog = document.getElementById("patient-restore-dialog");
  if (!dialog) return;
  document.getElementById("patient-restore-id").value = patientId;
  document.getElementById("patient-restore-name").textContent = patientName;
  document.getElementById("patient-restore-message").textContent = "";
  if (!dialog.open) dialog.showModal();
}

async function restoreArchivedPatient() {
  const patientId = document.getElementById("patient-restore-id")?.value;
  const button = document.getElementById("patient-restore-confirm");
  const message = document.getElementById("patient-restore-message");
  if (!patientId || !button || !message) return;

  button.disabled = true;
  message.textContent = "Restoring patient...";
  message.classList.remove("error", "success");
  try {
    const response = await fetch(
      `/api/patients/${encodeURIComponent(patientId)}/restore`,
      { method: "PATCH" },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to restore patient.");
    }
    document.getElementById("patient-restore-dialog").close();
    await loadArchivedPatients(archivedPatientState.page);
    const listMessage = document.getElementById("archive-patient-list-message");
    if (listMessage) listMessage.textContent = data.message;
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("error");
  } finally {
    button.disabled = false;
  }
}

function initPatientArchives() {
  const archiveDialog = document.getElementById("patient-archive-dialog");
  const restoreDialog = document.getElementById("patient-restore-dialog");
  document
    .getElementById("patient-archive-button")
    ?.addEventListener("click", (event) => {
      const button = event.currentTarget;
      openPatientArchiveDialog(
        button.dataset.patientId,
        button.dataset.patientName,
      );
    });
  document
    .getElementById("patient-archive-form")
    ?.addEventListener("submit", submitPatientArchive);
  document.getElementById("patient-archive-cancel")?.addEventListener("click", () => {
    archiveDialog?.close();
  });
  document.getElementById("archive-patient-search")?.addEventListener(
    "input",
    debounce(() => loadArchivedPatients(1), 250),
  );
  document
    .getElementById("archive-patient-search")
    ?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") loadArchivedPatients(1);
    });
  document
    .getElementById("archive-patient-apply-filters")
    ?.addEventListener("click", () => {
      loadArchivedPatients(1);
      document
        .getElementById("archive-patient-filter-panel")
        ?.removeAttribute("open");
    });
  document
    .getElementById("archive-patient-reset-filters")
    ?.addEventListener("click", () => {
      [
        "archive-patient-search",
        "archive-patient-date-from",
        "archive-patient-date-to",
      ].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.value = "";
      });
      loadArchivedPatients(1);
      document
        .getElementById("archive-patient-filter-panel")
        ?.removeAttribute("open");
    });
  document
    .getElementById("archive-patient-previous-page")
    ?.addEventListener("click", () => {
      if (archivedPatientState.page > 1) {
        loadArchivedPatients(archivedPatientState.page - 1);
      }
    });
  document
    .getElementById("archive-patient-next-page")
    ?.addEventListener("click", () => {
      if (archivedPatientState.page < archivedPatientState.pages) {
        loadArchivedPatients(archivedPatientState.page + 1);
      }
    });
  document
    .getElementById("archive-patient-table-body")
    ?.addEventListener("click", (event) => {
      const button = event.target.closest(".patient-restore-button");
      if (button) {
        openPatientRestoreDialog(
          button.dataset.patientId,
          button.dataset.patientName,
        );
      }
    });
  document
    .getElementById("patient-restore-confirm")
    ?.addEventListener("click", restoreArchivedPatient);
  document
    .getElementById("patient-restore-cancel")
    ?.addEventListener("click", () => {
      restoreDialog?.close();
    });
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
    const items = await res.json().catch(() => []);
    if (!res.ok) throw new Error("Unable to search dentists.");
    renderDentistSuggestions(items, targetListId);
  } catch (err) {
    console.error(err);
    const list = document.getElementById(targetListId);
    if (list) {
      list.innerHTML =
        '<div style="padding:10px;color:#b42318;">Unable to search dentists.</div>';
    }
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
      date_of_birth: document.getElementById("promote_date_of_birth")?.value,
      gender: document.getElementById("promote_gender")?.value,
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
      `Role assigned successfully. New ${data.role} profile created: ID ${data.doctor_id || data.staff_id}.`,
    );
    loadDoctorStaffSummaries();
    document.getElementById("user-search").value = "";
    document.getElementById("selected-user-id").value = "";
    updateSelectedUserCard(null);
    clearUserSuggestions();
    document.getElementById("promote-role").value = "";
    [
      "promote_date_of_birth",
      "promote_gender",
      "promote_hire_date",
      "specialization",
      "license_number",
      "shift_schedule",
    ].forEach((id) => {
      const field = document.getElementById(id);
      if (field) field.value = "";
    });
    showRoleSpecificFields();
  } catch (err) {
    showResult(resultBox, `Error: ${err?.message || "Unknown error"}`);
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
              .map(
                (item) =>
                  `<div>${escapeHtml(item.name)} — ${escapeHtml(item.specialization)} — License: ${escapeHtml(item.license_number)} — Hired: ${escapeHtml(item.hire_date || "Not recorded")}</div>`,
              )
              .join("")
          : '<div style="color:#666;">No doctors yet.</div>';
    if (staffList)
      staffList.innerHTML =
        data.staff?.length > 0
          ? data.staff
              .map(
                (item) =>
                  `<div>${escapeHtml(item.name)} — ${escapeHtml(item.shift_schedule)}</div>`,
              )
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

function showResult(el, message) {
  if (!el) return;
  el.textContent = message;
}

function formatDoctorScheduleTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return value || "—";
  const hour = Number(match[1]);
  const minute = match[2];
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${hour >= 12 ? "PM" : "AM"}`;
}

function renderDoctorCurrentSchedule(schedules) {
  const content = document.getElementById("doctor-current-schedule-content");
  if (!content) return;

  const schedulesByDay = new Map(
    SCHEDULE_WEEKDAYS.map((day) => [day, []]),
  );
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    if (schedulesByDay.has(schedule.day_of_week)) {
      schedulesByDay.get(schedule.day_of_week).push(schedule);
    }
  });

  content.innerHTML = `
    <table class="doctor-current-schedule__table">
      <thead>
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Current availability</th>
        </tr>
      </thead>
      <tbody>
        ${SCHEDULE_WEEKDAYS.map((day) => {
          const daySchedules = schedulesByDay.get(day);
          const availability = daySchedules.length
            ? daySchedules
                .map(
                  (schedule) =>
                    `<span class="schedule-time-range">${escapeHtml(formatDoctorScheduleTime(schedule.start_time))}–${escapeHtml(formatDoctorScheduleTime(schedule.end_time))}</span>`,
                )
                .join("")
            : '<span class="schedule-not-set">Not scheduled</span>';
          return `<tr><th scope="row">${day}</th><td>${availability}</td></tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

async function loadDoctorCurrentSchedule() {
  const section = document.getElementById("doctor-current-schedule-section");
  const content = document.getElementById("doctor-current-schedule-content");
  if (!section || !content || managementRole !== "doctor") return;

  section.hidden = false;
  content.textContent = "Loading current schedule...";
  try {
    const response = await fetch("/api/dentist-schedule/me");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to load your current schedule.");
    }
    renderDoctorCurrentSchedule(data.schedules);
  } catch (error) {
    content.textContent = error.message || "Unable to load your current schedule.";
  }
}

async function loadEmergencyDoctorAssignment() {
  if (managementRole !== "superadmin") return;
  const select = document.getElementById("emergency_dentist_id");
  const current = document.getElementById("current-emergency-doctor");
  if (!select || !current) return;

  select.disabled = true;
  current.textContent = "Loading...";
  try {
    const [doctorsResponse, assignmentResponse] = await Promise.all([
      fetch("/api/dentists"),
      fetch("/api/emergency-doctor"),
    ]);
    const doctors = await doctorsResponse.json().catch(() => []);
    const assignment = await assignmentResponse.json().catch(() => ({}));
    if (!doctorsResponse.ok) {
      throw new Error(doctors.error || "Unable to load doctors.");
    }
    if (!assignmentResponse.ok || !assignment.ok) {
      throw new Error(assignment.error || "Unable to load the assignment.");
    }

    select.innerHTML = '<option value="">Select a doctor</option>';
    doctors.forEach((doctor) => {
      const option = document.createElement("option");
      option.value = doctor.dentist_id;
      option.textContent = `${doctor.first_name} ${doctor.last_name}${
        doctor.specialization ? ` (${doctor.specialization})` : ""
      }`;
      select.appendChild(option);
    });

    const assignedDoctor = assignment.doctor;
    if (assignedDoctor) {
      select.value = String(assignedDoctor.dentist_id);
      current.textContent = `Dr. ${assignedDoctor.first_name} ${assignedDoctor.last_name}`;
    } else {
      current.textContent = "None — emergency booking is unavailable";
    }
    select.disabled = doctors.length === 0;
  } catch (error) {
    current.textContent = error.message || "Unable to load the assignment.";
    select.innerHTML = '<option value="">Unable to load doctors</option>';
  }
}

async function updateEmergencyDoctor(dentistId) {
  const resultBox = document.getElementById("emergency-doctor-result");
  showResult(resultBox, "Saving emergency doctor assignment...");
  const response = await fetch("/api/emergency-doctor", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dentist_id: dentistId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || "Unable to update the emergency doctor.");
  }
  showResult(resultBox, data.message);
  await loadEmergencyDoctorAssignment();
}

async function submitEmergencyDoctorForm(event) {
  event.preventDefault();
  const select = event.currentTarget.elements.dentist_id;
  const dentistId = Number(select.value);
  if (!dentistId) {
    showResult(
      document.getElementById("emergency-doctor-result"),
      "Please select a doctor.",
    );
    return;
  }
  try {
    await updateEmergencyDoctor(dentistId);
  } catch (error) {
    showResult(
      document.getElementById("emergency-doctor-result"),
      `Error: ${error.message || "Unable to update the emergency doctor."}`,
    );
  }
}

async function clearEmergencyDoctorAssignment() {
  if (
    !window.confirm(
      "Clear the emergency doctor? New emergency bookings will be unavailable until another doctor is assigned.",
    )
  ) {
    return;
  }
  try {
    await updateEmergencyDoctor(null);
  } catch (error) {
    showResult(
      document.getElementById("emergency-doctor-result"),
      `Error: ${error.message || "Unable to clear the emergency doctor."}`,
    );
  }
}

async function submitClinicHoursForm(e) {
  e.preventDefault();
  const form = e.target;
  const resultBox = document.getElementById("clinic-hours-result");
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  showResult(resultBox, "Saving doctor availability...");

  try {
    const payload = getFormPayload(form);
    payload.days_of_week = Array.from(
      form.querySelectorAll('input[name="days_of_week"]:checked'),
      (checkbox) => checkbox.value,
    );
    const missing = [];
    if (managementRole !== "doctor" && !payload.dentist_id) {
      missing.push("dentist_id");
    }
    if (!payload.days_of_week.length) missing.push("regular days");
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
      throw new Error(data.error || "Failed to save doctor availability");
    }

    const updatedDays = Array.isArray(data.updated_days)
      ? data.updated_days
      : [];
    showResult(
      resultBox,
      `Doctor availability updated for ${data.schedule_count} day${data.schedule_count === 1 ? "" : "s"}: ${updatedDays.join(", ")}.`,
    );
    form.reset();
    if (managementRole === "doctor") await loadDoctorCurrentSchedule();
  } catch (err) {
    showResult(resultBox, `Error: ${err?.message || "Unknown error"}`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadStaffShiftSchedule() {
  const currentShift = document.getElementById("staff-current-shift");
  if (!currentShift || managementRole !== "staff") return;

  currentShift.textContent = "Loading...";
  try {
    const response = await fetch("/api/staff/me/shift-schedule");
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to load your shift schedule.");
    }
    currentShift.textContent = data.shift_schedule || "Not set";
    populateStaffShiftForm(data.shift_schedule);
  } catch (error) {
    currentShift.textContent = error.message;
  }
}

function parseStaffShiftSchedule(shiftSchedule) {
  const match = String(shiftSchedule || "").match(
    /^(.*):\s*([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/,
  );
  if (!match) return { workDays: [], startTime: "", endTime: "" };

  const workDaysText = match[1].trim();
  const rangePattern = new RegExp(
    `(${SCHEDULE_WEEKDAYS.join("|")})\\s*(?:to|-)\\s*(${SCHEDULE_WEEKDAYS.join("|")})`,
    "i",
  );
  const range = workDaysText.match(rangePattern);
  let workDays;
  if (range) {
    const startIndex = SCHEDULE_WEEKDAYS.findIndex(
      (day) => day.toLowerCase() === range[1].toLowerCase(),
    );
    const endIndex = SCHEDULE_WEEKDAYS.findIndex(
      (day) => day.toLowerCase() === range[2].toLowerCase(),
    );
    workDays =
      startIndex >= 0 && endIndex >= startIndex
        ? SCHEDULE_WEEKDAYS.slice(startIndex, endIndex + 1)
        : [];
  } else {
    workDays = SCHEDULE_WEEKDAYS.filter((day) =>
      new RegExp(`\\b${day}\\b`, "i").test(workDaysText),
    );
  }

  return {
    workDays,
    startTime: `${match[2]}:${match[3]}`,
    endTime: `${match[4]}:${match[5]}`,
  };
}

function populateStaffShiftForm(shiftSchedule) {
  const form = document.getElementById("staff-shift-form");
  if (!form) return;
  const parsed = parseStaffShiftSchedule(shiftSchedule);
  const selectedDays = new Set(parsed.workDays);
  form.querySelectorAll('input[name="work_days"]').forEach((checkbox) => {
    checkbox.checked = selectedDays.has(checkbox.value);
  });
  form.elements.start_time.value = parsed.startTime;
  form.elements.end_time.value = parsed.endTime;
}

async function submitStaffShiftForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const resultBox = document.getElementById("staff-shift-result");
  const submitButton = form.querySelector('button[type="submit"]');
  const payload = getFormPayload(form);
  payload.work_days = Array.from(
    form.querySelectorAll('input[name="work_days"]:checked'),
    (checkbox) => checkbox.value,
  );

  if (!payload.work_days.length) {
    showResult(resultBox, "Error: Select at least one work day.");
    return;
  }

  if (payload.start_time >= payload.end_time) {
    showResult(resultBox, "Error: Shift start must be before shift end.");
    return;
  }

  if (submitButton) submitButton.disabled = true;
  showResult(resultBox, "Saving shift schedule...");
  try {
    const response = await fetch("/api/staff/me/shift-schedule", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to save your shift schedule.");
    }
    document.getElementById("staff-current-shift").textContent =
      data.shift_schedule;
    showResult(resultBox, "Shift schedule saved successfully.");
  } catch (error) {
    showResult(resultBox, `Error: ${error.message}`);
  } finally {
    if (submitButton) submitButton.disabled = false;
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
      `Staff saved successfully. Staff ID: ${data.staff_id}. Inserted Staff User ID: ${data.user_id ?? "N/A"}.`,
    );

    form.reset();
  } catch (err) {
    showResult(
      resultBox,
      `Error: ${err?.message ? String(err.message) : "Unknown error"}`,
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
    payload.license_number = payload.license_number?.trim() || null;

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
      `Doctor saved successfully. Doctor ID: ${data.doctor_id ?? "N/A"}.`,
    );

    form.reset();
  } catch (err) {
    showResult(
      resultBox,
      `Error: ${err?.message ? String(err.message) : "Unknown error"}`,
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
  const btnStaffShift = document.getElementById("btn-show-staff-shift");
  const btnEmergencyDoctor = document.getElementById(
    "btn-show-emergency-doctor",
  );
  const appointmentCard = document.getElementById("appointment-form-card");
  const clinicHoursCard = document.getElementById("clinic-hours-form-card");
  const staffShiftCard = document.getElementById("staff-shift-form-card");
  const emergencyDoctorCard = document.getElementById(
    "emergency-doctor-form-card",
  );

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
    if (staffShiftCard) staffShiftCard.style.display = "none";
    if (emergencyDoctorCard) emergencyDoctorCard.style.display = "none";
  }

  function showClinicHoursForm() {
    if (appointmentCard) appointmentCard.style.display = "none";
    if (clinicHoursCard) clinicHoursCard.style.display = "block";
    if (staffShiftCard) staffShiftCard.style.display = "none";
    if (emergencyDoctorCard) emergencyDoctorCard.style.display = "none";
    if (managementRole === "doctor") loadDoctorCurrentSchedule();
  }

  function showStaffShiftForm() {
    if (appointmentCard) appointmentCard.style.display = "none";
    if (clinicHoursCard) clinicHoursCard.style.display = "none";
    if (staffShiftCard) staffShiftCard.style.display = "block";
    if (emergencyDoctorCard) emergencyDoctorCard.style.display = "none";
    loadStaffShiftSchedule();
  }

  function showEmergencyDoctorForm() {
    if (appointmentCard) appointmentCard.style.display = "none";
    if (clinicHoursCard) clinicHoursCard.style.display = "none";
    if (staffShiftCard) staffShiftCard.style.display = "none";
    if (emergencyDoctorCard) emergencyDoctorCard.style.display = "block";
    loadEmergencyDoctorAssignment();
  }

  if (btnDoctor) btnDoctor.addEventListener("click", showDoctorForm);
  if (btnStaff) btnStaff.addEventListener("click", showStaffForm);
  if (btnAppointment)
    btnAppointment.addEventListener("click", showAppointmentForm);
  if (btnClinicHours)
    btnClinicHours.addEventListener("click", showClinicHoursForm);
  if (btnStaffShift)
    btnStaffShift.addEventListener("click", showStaffShiftForm);
  if (btnEmergencyDoctor) {
    btnEmergencyDoctor.addEventListener("click", showEmergencyDoctorForm);
  }

  const doctorForm = document.getElementById("doctor-form");
  const staffForm = document.getElementById("staff-form");
  const clinicHoursForm = document.getElementById("clinic-hours-form");
  const staffShiftForm = document.getElementById("staff-shift-form");
  const emergencyDoctorForm = document.getElementById(
    "emergency-doctor-form",
  );
  const clearEmergencyDoctor = document.getElementById(
    "clear-emergency-doctor",
  );
  const refreshDoctorSchedule = document.getElementById(
    "refresh-doctor-schedule",
  );

  if (doctorForm) doctorForm.addEventListener("submit", submitDoctorForm);
  if (staffForm) staffForm.addEventListener("submit", submitStaffForm);
  if (clinicHoursForm)
    clinicHoursForm.addEventListener("submit", submitClinicHoursForm);
  if (staffShiftForm)
    staffShiftForm.addEventListener("submit", submitStaffShiftForm);
  if (emergencyDoctorForm) {
    emergencyDoctorForm.addEventListener("submit", submitEmergencyDoctorForm);
  }
  if (clearEmergencyDoctor) {
    clearEmergencyDoctor.addEventListener(
      "click",
      clearEmergencyDoctorAssignment,
    );
  }
  if (refreshDoctorSchedule)
    refreshDoctorSchedule.addEventListener("click", loadDoctorCurrentSchedule);

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
    const debouncedPatientSearch = debounce(searchPatients, 200);
    patientSearch.addEventListener("input", (e) => {
      const patientId = document.getElementById("patient_id");
      if (patientId) patientId.value = "";
      debouncedPatientSearch(e.target.value || "");
    });
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
  if (patientInfoSearch && patientInfoSuggestions) {
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

  const patientStatusSearch = document.getElementById("patient-status-search");
  const patientStatusSuggestions = document.getElementById(
    "patient-status-suggestions",
  );
  if (patientStatusSearch && patientStatusSuggestions) {
    patientStatusSearch.addEventListener(
      "input",
      debounce((event) => searchPatientStatus(event.target.value || ""), 200),
    );
  }
  if (patientStatusSuggestions) {
    patientStatusSuggestions.addEventListener("click", async (event) => {
      const option = event.target.closest(".patient-status-option");
      if (!option) return;
      patientStatusSearch.value = option.dataset.patientName || "";
      patientStatusSuggestions.innerHTML = "";
      await loadPatientStatus(option.dataset.patientId);
    });
  }
  document
    .getElementById("patient-status-save")
    ?.addEventListener("click", savePatientStatus);

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
      !event.target.closest("#patient-status-search") &&
      !event.target.closest("#patient-status-suggestions")
    ) {
      const suggestions = document.getElementById(
        "patient-status-suggestions",
      );
      if (suggestions) suggestions.innerHTML = "";
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

  initPatientDirectories();
  initPatientArchives();
  initDentalRecordsTab();
  initReportsTab();
  initBillingTab();
  initAuditLogsTab();
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
let dentalToothChartsById = new Map();
let dentalCurrentToothRecordId = null;
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
        `<div class="suggestion-item" data-patient-id="${escapeHtml(p.patient_id)}">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)} · ${escapeHtml(p.email || p.contact_number || "")}</div>`,
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

function toothBox(num, status, recordId) {
  const normalizedStatus = TOOTH_STATUS_ORDER.includes(status)
    ? status
    : "healthy";
  const style = TOOTH_STATUS_STYLES[normalizedStatus];
  return `
    <div class="tooth-box" data-tooth="${num}" data-record-id="${recordId}" data-status="${normalizedStatus}"
      title="Tooth ${num} — ${TOOTH_STATUS_LABELS[normalizedStatus]} (click to change)"
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

function renderToothChart(container, toothChart, recordId) {
  if (!container) return;
  if (!recordId) {
    container.innerHTML =
      '<p style="text-align:center;">No treatment-linked tooth chart is available.</p>';
    return;
  }

  const upperRow = [];
  for (let i = 1; i <= 16; i++) {
    upperRow.push(toothBox(i, toothChart[i] || "healthy", recordId));
  }
  const lowerRow = [];
  for (let i = 17; i <= 32; i++) {
    lowerRow.push(toothBox(i, toothChart[i] || "healthy", recordId));
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
  const recordKey = String(box.dataset.recordId || "");
  const chartRecord = dentalToothChartsById.get(recordKey);
  if (!chartRecord) return;

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
        dental_record_id: Number(chartRecord.dental_record_id) || null,
        appointment_id: chartRecord.appointment_id || null,
        patient_id: dentalCurrentPatientId,
        tooth_number: toothNum,
        condition_status: next,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to update tooth status");
    }
    const savedRecordKey = String(data.dental_record_id);
    if (savedRecordKey !== recordKey) {
      dentalToothChartsById.delete(recordKey);
      chartRecord.dental_record_id = data.dental_record_id;
      dentalToothChartsById.set(savedRecordKey, chartRecord);
      const select = document.getElementById("tooth-chart-record-select");
      const option = select
        ? [...select.options].find((item) => item.value === recordKey)
        : null;
      if (option) option.value = savedRecordKey;
      if (select) select.value = savedRecordKey;
    }
    chartRecord.tooth_chart[toothNum] = next;
    chartRecord.teeth = data.teeth_involved || "None";
    showToothChartRecord(savedRecordKey);

    const treatment = dentalTreatmentsById.get(savedRecordKey);
    if (treatment) {
      treatment.teeth = data.teeth_involved || "None";
      renderTreatmentsTable([...dentalTreatmentsById.values()]);
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

function showToothChartRecord(recordId) {
  const record = dentalToothChartsById.get(String(recordId));
  const summary = document.getElementById("tooth-chart-record-summary");
  dentalCurrentToothRecordId = record ? String(recordId) : null;

  if (!record) {
    if (summary) summary.textContent = "";
    renderToothChart(
      document.getElementById("tooth-chart-container"),
      {},
      null,
    );
    return;
  }

  if (summary) {
    const appointment = record.appointment_id
      ? `Appointment #${record.appointment_id}`
      : "No linked appointment";
    summary.textContent = `${formatDentalDate(record.date)} | ${record.procedure} | ${appointment} | Tooth(s): ${record.teeth}`;
  }
  renderToothChart(
    document.getElementById("tooth-chart-container"),
    record.tooth_chart || {},
    record.dental_record_id,
  );
}

function renderToothChartRecords(records, preferredRecordId = null) {
  const select = document.getElementById("tooth-chart-record-select");
  const controls = document.getElementById("tooth-chart-record-controls");
  if (!select) return;

  dentalToothChartsById = new Map(
    (records || []).map((record) => [String(record.dental_record_id), record]),
  );
  if (!records?.length) {
    select.innerHTML = '<option value="">No tooth-chart records</option>';
    select.disabled = true;
    if (controls) controls.hidden = true;
    showToothChartRecord(null);
    return;
  }

  if (controls) controls.hidden = false;
  select.disabled = false;
  select.innerHTML = records
    .map((record) => {
      const appointment = record.appointment_id
        ? `Appointment #${record.appointment_id}`
        : "Unlinked treatment";
      return `<option value="${escapeHtml(record.dental_record_id)}">${escapeHtml(formatDentalDate(record.date))} - ${escapeHtml(record.procedure)} - ${escapeHtml(appointment)}</option>`;
    })
    .join("");

  const requestedId = String(preferredRecordId || "");
  select.value = dentalToothChartsById.has(requestedId)
    ? requestedId
    : String(records[0].dental_record_id);
  showToothChartRecord(select.value);
}

function includeAppointmentToothCharts(appointments) {
  const records = [...dentalToothChartsById.values()];
  const includedAppointments = new Set(
    records
      .map((record) => String(record.appointment_id || ""))
      .filter(Boolean),
  );

  (appointments || []).forEach((appointment) => {
    if (["cancelled", "no_show"].includes(appointment.appointment_status)) {
      return;
    }
    const appointmentId = String(appointment.appointment_id);
    if (includedAppointments.has(appointmentId)) return;
    records.push({
      dental_record_id: `appointment-${appointmentId}`,
      appointment_id: appointment.appointment_id,
      date: appointment.appointment_date,
      procedure: appointment.appointment_type,
      teeth: "None",
      doctor: appointment.doctor_name || "Unassigned",
      tooth_chart: {},
    });
  });

  renderToothChartRecords(records, dentalCurrentToothRecordId);
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
    dentalTreatmentsById = new Map();
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
        <td style="display:flex;gap:8px;flex-wrap:wrap;">
          <button
            type="button"
            class="btn-view-tooth-chart"
            data-treatment-id="${escapeHtml(t.treatment_id)}"
          >
            Chart
          </button>
          <button
            type="button"
            class="btn-edit-treatment"
            data-treatment-id="${escapeHtml(t.treatment_id)}"
          >
            Edit
          </button>
          <button
            type="button"
            class="btn-delete-treatment danger-button"
            data-treatment-id="${escapeHtml(t.treatment_id)}"
          >
            Delete
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
        <td>${v.appointment_id ? `#${escapeHtml(v.appointment_id)} · ${escapeHtml(formatDentalDate(v.appointment_date))}` : "Unlinked (legacy)"}</td>
        <td>${escapeHtml(formatDentalDate(v.date))}</td>
        <td>${escapeHtml(v.bp)}</td>
        <td>${escapeHtml(v.pulse)}</td>
        <td>${escapeHtml(v.temp)}</td>
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

function renderDentalMedicalAlerts(patient) {
  const container = document.getElementById("dental-medical-alerts");
  if (!container) return;

  const alerts = [];
  if (patient.diabetes_status === "yes") {
    alerts.push({ label: "Diabetes", value: "Patient is diabetic", urgent: true });
  } else if (patient.diabetes_status === "unknown") {
    alerts.push({
      label: "Diabetes",
      value: "Status has not been confirmed",
      urgent: false,
    });
  }

  const allergies = Array.isArray(patient.allergies)
    ? patient.allergies.filter(Boolean)
    : [];
  if (allergies.length) {
    alerts.push({
      label: "Allergies",
      value: allergies.join(", "),
      urgent: true,
    });
  }

  container.replaceChildren();
  alerts.forEach((alert) => {
    const item = document.createElement("div");
    item.className = `dental-medical-alert${alert.urgent ? " is-urgent" : ""}`;

    const label = document.createElement("strong");
    label.textContent = `${alert.label}: `;
    const value = document.createElement("span");
    value.textContent = alert.value;
    item.append(label, value);
    container.appendChild(item);
  });
  container.hidden = alerts.length === 0;
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
    renderDentalMedicalAlerts(data.patient);

    renderToothChartRecords(data.tooth_charts || []);
    renderToothChartLegend(document.getElementById("tooth-chart-legend"));
    renderTreatmentsTable(data.treatments);
    renderVitalsTable(data.vitals);
    loadPatientAppointmentsForTreatmentForm(dentalCurrentPatientId);
    loadPatientAppointmentsForVitalsForm(dentalCurrentPatientId);

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

    includeAppointmentToothCharts(data.appointments || []);

    (data.appointments || []).forEach((a) => {
      if (
        a.has_treatment ||
        ["cancelled", "no_show"].includes(a.appointment_status)
      )
        return;
      const opt = document.createElement("option");
      opt.value = a.appointment_id;
      opt.dataset.dentistId = a.dentist_id || "";
      opt.dataset.doctorName = a.doctor_name || "";
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

async function loadPatientAppointmentsForVitalsForm(patientId) {
  const select = document.getElementById("vitals_appointment");
  if (!select || !patientId) return;

  select.innerHTML = '<option value="">Select appointment</option>';

  try {
    const res = await fetch(
      `/api/appointments/patient/${encodeURIComponent(patientId)}`,
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return;

    (data.appointments || []).forEach((appointment) => {
      if (["cancelled", "no_show"].includes(appointment.appointment_status)) {
        return;
      }
      const option = document.createElement("option");
      option.value = appointment.appointment_id;
      option.dataset.date = appointment.appointment_date || "";
      option.textContent = `#${appointment.appointment_id} - ${formatDentalDate(appointment.appointment_date)} - ${appointment.appointment_type} (${appointment.appointment_status})`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error(error);
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

  if (searchInput && suggestions) {
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
  const toothChartRecordSelect = document.getElementById(
    "tooth-chart-record-select",
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
    treatmentsBody.addEventListener("click", async (e) => {
      const chartButton = e.target.closest(".btn-view-tooth-chart");
      if (chartButton) {
        const recordId = chartButton.dataset.treatmentId;
        showDentalSubtab("tooth-chart");
        if (toothChartRecordSelect) toothChartRecordSelect.value = recordId;
        showToothChartRecord(recordId);
        return;
      }

      const deleteButton = e.target.closest(".btn-delete-treatment");
      if (deleteButton) {
        const treatment = dentalTreatmentsById.get(
          deleteButton.dataset.treatmentId,
        );
        if (!treatment) return;

        const confirmed = window.confirm(
          `Delete the ${treatment.procedure || "selected"} treatment? This cannot be undone.`,
        );
        if (!confirmed) return;

        const originalText = deleteButton.textContent;
        deleteButton.disabled = true;
        deleteButton.textContent = "Deleting...";

        try {
          const res = await fetch(
            `/api/dental-records/${encodeURIComponent(treatment.treatment_id)}/treatment`,
            { method: "DELETE" },
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.ok) {
            throw new Error(data.error || "Failed to delete treatment");
          }

          await loadDentalPatientRecord(dentalCurrentPatientId);
          showDentalSubtab("treatments");
        } catch (err) {
          console.error(err);
          alert(err.message || "Failed to delete treatment.");
          deleteButton.disabled = false;
          deleteButton.textContent = originalText;
        }
        return;
      }

      const editButton = e.target.closest(".btn-edit-treatment");
      if (!editButton) return;
      const treatment = dentalTreatmentsById.get(
        editButton.dataset.treatmentId,
      );
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

  if (toothChartRecordSelect) {
    toothChartRecordSelect.addEventListener("change", () => {
      showToothChartRecord(toothChartRecordSelect.value);
    });
  }

  if (treatmentDentistSearch) {
    const runTreatmentDentistSearch = debounce(
      (query) =>
        searchDentists(query || "", "treatment-dentist-suggestions"),
      200,
    );
    treatmentDentistSearch.addEventListener("input", (e) => {
      document.getElementById("treatment_dentist_id").value = "";
      runTreatmentDentistSearch(e.target.value || "");
    });
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
      if (!opt) return;
      if (!opt.value) {
        document.getElementById("treatment_dentist_id").value = "";
        treatmentDentistSearch.value = "";
        treatmentDentistSuggestions.innerHTML = "";
        return;
      }
      if (opt.dataset.date) {
        document.getElementById("treatment_date").value = opt.dataset.date;
      }
      if (opt.dataset.dentistId) {
        document.getElementById("treatment_dentist_id").value =
          opt.dataset.dentistId;
        treatmentDentistSearch.value = opt.dataset.doctorName || "";
        treatmentDentistSuggestions.innerHTML = "";
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
  const vitalsAppointmentSelect = document.getElementById("vitals_appointment");
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

  if (vitalsAppointmentSelect) {
    vitalsAppointmentSelect.addEventListener("change", () => {
      const option = vitalsAppointmentSelect.selectedOptions[0];
      if (option?.dataset.date) {
        document.getElementById("vitals_date").value = option.dataset.date;
      }
    });
  }

  if (recordVitalsForm) {
    recordVitalsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!dentalCurrentPatientId) return;

      const payload = {
        patient_id: dentalCurrentPatientId,
        appointment_id: document.getElementById("vitals_appointment").value,
        date_recorded: document.getElementById("vitals_date").value,
        blood_pressure: document.getElementById("vitals_bp").value,
        heart_rate: document.getElementById("vitals_pulse").value,
        temperature: document.getElementById("vitals_temp").value,
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

function formatBillingStatus(status) {
  if (status === "paid") return "Fully paid";
  if (status === "partial") return "Partially paid";
  return "Unpaid";
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
            <td>${escapeHtml(formatBillingStatus(row.billing_status))}</td>
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

function renderBillingPaymentHistory(payments, billingStatus) {
  const tbody = document.getElementById("billing-payment-history");
  if (!tbody) return;
  if (!payments?.length) {
    tbody.innerHTML = '<tr><td colspan="9">No payments recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = payments
    .map((payment) => {
      const action =
        payment.payment_status === "pending"
          ? `
            <label>
              Payment status
              <select class="billing-payment-status-edit">
                <option value="">Select status</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </label>
            <label>
              Billing status
              <select class="billing-status-after-payment-edit">
                ${["unpaid", "partial", "paid"]
                  .map(
                    (status) => {
                      const label = formatBillingStatus(status);
                      return `<option value="${status}"${status === billingStatus ? " selected" : ""}>${label}</option>`;
                    },
                  )
                  .join("")}
              </select>
            </label>
            <label>
              Status change note
              <textarea class="billing-payment-status-note" maxlength="255" required placeholder="Explain this status change"></textarea>
            </label>
            <button type="button" class="billing-payment-status-update" data-payment-id="${escapeHtml(payment.payment_id)}">Update</button>`
          : "-";

      return `
        <tr>
          <td>${escapeHtml(payment.payment_date)}</td>
          <td>${escapeHtml(formatPeso(payment.amount_paid))}</td>
          <td>${escapeHtml(payment.payment_method)}</td>
          <td>${escapeHtml(payment.payment_status)}</td>
          <td>${escapeHtml(payment.reference_number || "-")}</td>
          <td>${escapeHtml(payment.external_reference || "-")}</td>
          <td>${escapeHtml(payment.recorded_by_name)}</td>
          <td>${escapeHtml(payment.notes || "-")}</td>
          <td>${action}</td>
        </tr>`;
    })
    .join("");
}

function renderBillingStatusNotes(notes) {
  const tbody = document.getElementById("billing-status-notes");
  if (!tbody) return;
  if (!notes?.length) {
    tbody.innerHTML =
      '<tr><td colspan="6">No status notes recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = notes
    .map((statusNote) => {
      const referenceParts = [
        statusNote.reference_number,
        statusNote.external_reference
          ? `External: ${statusNote.external_reference}`
          : null,
      ].filter(Boolean);
      const method = statusNote.payment_method
        ? `${statusNote.payment_method_label} (${statusNote.payment_channel})`
        : statusNote.payment_method_label;

      return `
        <tr>
          <td>${escapeHtml(statusNote.changed_at)}</td>
          <td>${escapeHtml(formatBillingStatus(statusNote.billing_status))}</td>
          <td>${escapeHtml(referenceParts.join(" / ") || "-")}</td>
          <td>${escapeHtml(method || "Manual adjustment")}</td>
          <td>${escapeHtml(statusNote.changed_by_name || "Unknown")}</td>
          <td>${escapeHtml(statusNote.note)}</td>
        </tr>`;
    })
    .join("");
}

function syncPaymentExternalReferenceVisibility() {
  const method = document.getElementById("billing-payment-method")?.value;
  const field = document.getElementById(
    "billing-payment-external-reference-field",
  );
  const input = document.getElementById(
    "billing-payment-external-reference",
  );
  if (!field || !input) return;

  const shouldShow = ["e_wallet", "bank_transfer"].includes(method);
  field.hidden = !shouldShow;
  input.disabled = !shouldShow;
  if (!shouldShow) input.value = "";
}

async function openBillingStatement(billingId) {
  const dialog = document.getElementById("billing-view-dialog");
  const statusOnlyMessage = document.getElementById(
    "billing-status-only-message",
  );
  const updateError = document.getElementById("billing-update-error");
  const paymentError = document.getElementById("billing-payment-error");
  if (!dialog) return;
  if (statusOnlyMessage) statusOnlyMessage.textContent = "";
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
    const hasZeroBalance = Math.abs(Number(billing.balance)) < 0.005;
    const statusOnlySelect = document.getElementById(
      "billing-status-only-select",
    );
    const statusOnlyHelp = document.getElementById("billing-status-only-help");
    if (statusOnlySelect) {
      Array.from(statusOnlySelect.options).forEach((option) => {
        option.disabled = hasZeroBalance && option.value !== "paid";
      });
      statusOnlySelect.value = hasZeroBalance
        ? "paid"
        : billing.billing_status;
    }
    if (statusOnlyHelp) {
      statusOnlyHelp.textContent = hasZeroBalance
        ? "The balance is zero, so you can mark this statement as Paid without entering payment details again."
        : "Use this to correct the billing status without entering another payment or changing the statement details.";
    }
    document.getElementById("billing-update-id").value = billing.billing_id;
    document.getElementById("billing-update-date").value = billing.billing_date;
    document.getElementById("billing-update-total").value = Number(
      billing.total_amount,
    ).toFixed(2);
    document.getElementById("billing-update-status").value =
      billing.billing_status;
    document.getElementById("billing-update-form").dataset.amountPaid =
      billing.amount_paid;
    document.getElementById("billing-update-form").dataset.originalStatus =
      billing.billing_status;
    document.getElementById("billing-payment-form").dataset.amountPaid =
      billing.amount_paid;
    document.getElementById("billing-payment-form").dataset.totalAmount =
      billing.total_amount;
    document.getElementById("billing-payment-date").value = billingToday();
    document.getElementById("billing-payment-amount").value = "";
    document.getElementById("billing-payment-method").value = "cash";
    document.getElementById("billing-payment-status").value = "completed";
    document.getElementById("billing-payment-billing-status").value =
      billing.billing_status;
    document.getElementById("billing-payment-external-reference").value = "";
    syncPaymentExternalReferenceVisibility();
    document.getElementById("billing-payment-notes").value = "";
    document.getElementById("billing-status-only-note").value = "";
    document.getElementById("billing-update-status-note").value = "";
    document.getElementById("billing-update-status-note").required = false;
    renderBillingPaymentHistory(data.payments || [], billing.billing_status);
    renderBillingStatusNotes(data.status_notes || []);

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
  const paymentHistory = document.getElementById("billing-payment-history");
  const statusOnlyForm = document.getElementById("billing-status-only-form");
  const updateForm = document.getElementById("billing-update-form");
  const paymentForm = document.getElementById("billing-payment-form");
  const updateTotal = document.getElementById("billing-update-total");
  const updateStatus = document.getElementById("billing-update-status");
  const updateStatusNote = document.getElementById(
    "billing-update-status-note",
  );
  const paymentAmount = document.getElementById("billing-payment-amount");
  const paymentStatus = document.getElementById("billing-payment-status");
  const paymentMethod = document.getElementById("billing-payment-method");
  const paymentBillingStatus = document.getElementById(
    "billing-payment-billing-status",
  );

  function valuesMatch(first, second) {
    return Math.abs(Number(first) - Number(second)) < 0.005;
  }

  function syncUpdatedStatementStatus() {
    if (!updateForm || !updateTotal || !updateStatus) return;
    if (valuesMatch(updateForm.dataset.amountPaid || 0, updateTotal.value)) {
      updateStatus.value = "paid";
    }
    if (updateStatusNote) {
      updateStatusNote.required =
        updateStatus.value !== updateForm.dataset.originalStatus;
    }
  }

  function syncPaymentStatementStatus() {
    if (
      !paymentForm ||
      !paymentAmount ||
      !paymentStatus ||
      !paymentBillingStatus
    )
      return;
    const completedAmount =
      Number(paymentForm.dataset.amountPaid || 0) +
      (paymentStatus.value === "completed"
        ? Number(paymentAmount.value || 0)
        : 0);
    if (valuesMatch(completedAmount, paymentForm.dataset.totalAmount || 0)) {
      paymentBillingStatus.value = "paid";
    }
  }

  updateTotal?.addEventListener("input", syncUpdatedStatementStatus);
  updateStatus?.addEventListener("change", syncUpdatedStatementStatus);
  paymentAmount?.addEventListener("input", syncPaymentStatementStatus);
  paymentStatus?.addEventListener("change", syncPaymentStatementStatus);
  paymentMethod?.addEventListener(
    "change",
    syncPaymentExternalReferenceVisibility,
  );
  syncPaymentExternalReferenceVisibility();

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
              status_note: document.getElementById(
                "billing-update-status-note",
              ).value,
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

  if (statusOnlyForm) {
    statusOnlyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = document.getElementById("billing-status-only-message");
      const billingId = document.getElementById("billing-update-id").value;
      const submitButton = statusOnlyForm.querySelector("button[type='submit']");
      message.textContent = "";
      submitButton.disabled = true;

      try {
        const result = await billingFetchJson(
          `/api/billings/${encodeURIComponent(billingId)}/status`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              billing_status: document.getElementById(
                "billing-status-only-select",
              ).value,
              status_note: document.getElementById(
                "billing-status-only-note",
              ).value,
            }),
          },
        );
        await openBillingStatement(billingId);
        await loadBillings();
        await loadStats();
        document.getElementById("billing-status-only-message").textContent =
          result.message;
      } catch (err) {
        message.textContent = err.message;
      } finally {
        submitButton.disabled = false;
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
        const paymentResult = await billingFetchJson(
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
              external_reference: document.getElementById(
                "billing-payment-external-reference",
              ).value,
              notes: document.getElementById("billing-payment-notes").value,
            }),
          },
        );
        await openBillingStatement(billingId);
        await loadBillings();
        document.getElementById("billing-payment-error").textContent =
          `Payment recorded. Reference: ${paymentResult.reference_number}`;
      } catch (err) {
        error.textContent = err.message;
      }
    });
  }

  if (paymentHistory) {
    paymentHistory.addEventListener("click", async (event) => {
      const button = event.target.closest(".billing-payment-status-update");
      if (!button) return;

      const row = button.closest("tr");
      const paymentStatus = row?.querySelector(
        ".billing-payment-status-edit",
      )?.value;
      const billingStatus = row?.querySelector(
        ".billing-status-after-payment-edit",
      )?.value;
      const statusNote = row?.querySelector(
        ".billing-payment-status-note",
      )?.value.trim();
      const error = document.getElementById("billing-payment-error");
      const billingId = document.getElementById("billing-update-id").value;
      error.textContent = "";

      if (!paymentStatus) {
        error.textContent = "Please select the payment's new status.";
        return;
      }
      if (!statusNote) {
        error.textContent = "Please enter a note for this status change.";
        return;
      }

      button.disabled = true;
      try {
        await billingFetchJson(
          `/api/payments/${encodeURIComponent(button.dataset.paymentId)}/status`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payment_status: paymentStatus,
              billing_status: billingStatus,
              status_note: statusNote,
            }),
          },
        );
        await openBillingStatement(billingId);
        await loadBillings();
        await loadStats();
        document.getElementById("billing-payment-error").textContent =
          "Payment status updated.";
      } catch (err) {
        error.textContent = err.message;
        button.disabled = false;
      }
    });
  }

  document
    .getElementById("billing-view-close")
    ?.addEventListener("click", () => {
      viewDialog.close();
    });
}

let auditCurrentPage = 1;
let auditTotalPages = 1;

function auditLabel(value) {
  return String(value || "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function auditDateTime(value) {
  if (!value) return "-";
  const date = new Date(String(value).replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function auditValueTable(rawValue) {
  if (!rawValue) return "<p>No values recorded.</p>";
  let value = rawValue;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (_) {
      return `<p>${escapeHtml(value)}</p>`;
    }
  }
  if (!value || typeof value !== "object" || !Object.keys(value).length) {
    return "<p>No values recorded.</p>";
  }
  return `
    <table>
      <thead><tr><th>Field</th><th>Value</th></tr></thead>
      <tbody>
        ${Object.entries(value)
          .map(([key, item]) => {
            const display =
              item && typeof item === "object"
                ? JSON.stringify(item)
                : String(item ?? "-");
            return `<tr><td>${escapeHtml(auditLabel(key))}</td><td>${escapeHtml(display)}</td></tr>`;
          })
          .join("")}
      </tbody>
    </table>`;
}

async function loadAuditLogs(page = auditCurrentPage) {
  const tbody = document.getElementById("audit-table-body");
  const message = document.getElementById("audit-list-message");
  if (!tbody) return;

  auditCurrentPage = Math.max(1, page);
  tbody.innerHTML = '<tr><td colspan="7">Loading audit logs...</td></tr>';
  if (message) message.textContent = "";

  const params = new URLSearchParams({
    page: String(auditCurrentPage),
    limit: "8",
  });
  const filters = {
    search: document.getElementById("audit-search")?.value.trim(),
    action: document.getElementById("audit-action-filter")?.value,
    entity_type: document.getElementById("audit-entity-filter")?.value,
    date_from: document.getElementById("audit-date-from")?.value,
    date_to: document.getElementById("audit-date-to")?.value,
  };
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  try {
    const data = await billingFetchJson(`/api/audit-logs?${params.toString()}`);
    const logs = data.logs || [];
    auditCurrentPage = data.pagination?.page || 1;
    auditTotalPages = data.pagination?.pages || 1;

    tbody.innerHTML = logs.length
      ? logs
          .map(
            (log) => `
              <tr>
                <td>${escapeHtml(auditDateTime(log.created_at))}</td>
                <td>${escapeHtml(log.actor_name_snapshot)}</td>
                <td>${escapeHtml(auditLabel(log.actor_type_snapshot))}</td>
                <td>${escapeHtml(auditLabel(log.action))}</td>
                <td>${escapeHtml(auditLabel(log.entity_type))} #${escapeHtml(log.entity_id || "-")}</td>
                <td>${escapeHtml(log.description)}</td>
                <td><button type="button" class="audit-view-button" data-audit-id="${escapeHtml(log.audit_log_id)}">View</button></td>
              </tr>`,
          )
          .join("")
      : '<tr><td colspan="7">No audit logs found.</td></tr>';

    const summary = document.getElementById("audit-pagination-summary");
    if (summary) {
      summary.textContent = `Page ${auditCurrentPage} of ${auditTotalPages} | ${data.pagination?.total || 0} logs`;
    }
    const previous = document.getElementById("audit-previous-page");
    const next = document.getElementById("audit-next-page");
    if (previous) previous.disabled = auditCurrentPage <= 1;
    if (next) next.disabled = auditCurrentPage >= auditTotalPages;
  } catch (err) {
    console.error(err);
    tbody.innerHTML =
      '<tr><td colspan="7">Unable to load audit logs.</td></tr>';
    if (message) message.textContent = err.message;
  }
}

async function openAuditDetails(auditLogId) {
  const dialog = document.getElementById("audit-details-dialog");
  if (!dialog) return;
  try {
    const data = await billingFetchJson(
      `/api/audit-logs/${encodeURIComponent(auditLogId)}`,
    );
    const log = data.log;
    document.getElementById("audit-detail-id").textContent =
      `#${log.audit_log_id}`;
    document.getElementById("audit-detail-date").textContent = auditDateTime(
      log.created_at,
    );
    document.getElementById("audit-detail-actor").textContent =
      log.actor_name_snapshot;
    document.getElementById("audit-detail-type").textContent = auditLabel(
      log.actor_type_snapshot,
    );
    document.getElementById("audit-detail-user-id").textContent =
      log.actor_user_id || "-";
    document.getElementById("audit-detail-ip").textContent =
      log.ip_address || "-";
    document.getElementById("audit-detail-action").textContent = auditLabel(
      log.action,
    );
    document.getElementById("audit-detail-record").textContent =
      `${auditLabel(log.entity_type)} #${log.entity_id || "-"}`;
    document.getElementById("audit-detail-description").textContent =
      log.description;
    document.getElementById("audit-detail-before").innerHTML = auditValueTable(
      log.old_values,
    );
    document.getElementById("audit-detail-after").innerHTML = auditValueTable(
      log.new_values,
    );
    if (!dialog.open) dialog.showModal();
  } catch (err) {
    const message = document.getElementById("audit-list-message");
    if (message) message.textContent = err.message;
  }
}

function initAuditLogsTab() {
  document
    .getElementById("audit-apply-filters")
    ?.addEventListener("click", () => {
      loadAuditLogs(1);
      document.getElementById("audit-filter-panel")?.removeAttribute("open");
    });
  document
    .getElementById("audit-search")
    ?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") loadAuditLogs(1);
    });
  document
    .getElementById("audit-reset-filters")
    ?.addEventListener("click", () => {
      [
        "audit-search",
        "audit-action-filter",
        "audit-entity-filter",
        "audit-date-from",
        "audit-date-to",
      ].forEach((id) => {
        document.getElementById(id).value = "";
      });
      loadAuditLogs(1);
      document.getElementById("audit-filter-panel")?.removeAttribute("open");
    });
  document
    .getElementById("audit-previous-page")
    ?.addEventListener("click", () => {
      if (auditCurrentPage > 1) loadAuditLogs(auditCurrentPage - 1);
    });
  document.getElementById("audit-next-page")?.addEventListener("click", () => {
    if (auditCurrentPage < auditTotalPages) loadAuditLogs(auditCurrentPage + 1);
  });
  document
    .getElementById("audit-table-body")
    ?.addEventListener("click", (event) => {
      const button = event.target.closest(".audit-view-button");
      if (button) openAuditDetails(button.dataset.auditId);
    });
  document
    .getElementById("audit-details-close")
    ?.addEventListener("click", () => {
      document.getElementById("audit-details-dialog").close();
    });
}

function reportLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setDefaultReportDates() {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const dateFrom = document.getElementById("report-date-from");
  const dateTo = document.getElementById("report-date-to");
  if (dateFrom) dateFrom.value = reportLocalIsoDate(firstDay);
  if (dateTo) dateTo.value = reportLocalIsoDate(lastDay);
}

function reportDisplayLabel(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "—";
  if (normalized === "no_show") return "Late / No Show";
  if (normalized === "partial") return "Partially paid";
  if (normalized === "paid") return "Fully paid";
  return normalized
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function reportDisplayDate(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text || "—";
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatReportCell(value, format) {
  if (format === "date") return reportDisplayDate(value);
  if (format === "dateOrText") return reportDisplayDate(value);
  if (format === "currency") return formatPeso(value);
  if (format === "label" || format === "status") {
    return reportDisplayLabel(value);
  }
  if (format === "minutes") {
    const minutes = Number(value);
    return minutes > 0 ? `${minutes} min` : "—";
  }
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function syncReportFilterVisibility() {
  document.querySelectorAll(".report-filter-group").forEach((group) => {
    const reportTypes = (group.dataset.reportTypes || "").split(/\s+/);
    const isDoctorFilter = group.querySelector("#report-dentist-filter");
    const shouldHide =
      !reportTypes.includes(selectedReportType) ||
      (Boolean(isDoctorFilter) && managementRole === "doctor");
    group.hidden = shouldHide;
    group.querySelectorAll("input, select").forEach((control) => {
      control.disabled = shouldHide;
    });
  });
}

function selectReportType(type) {
  const config = REPORT_CONFIG[type];
  if (!config) return;
  selectedReportType = type;
  document.querySelectorAll(".report-type-card").forEach((card) => {
    const selected = card.dataset.reportType === type;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
  const title = document.getElementById("report-filter-title");
  const description = document.getElementById("report-filter-description");
  const message = document.getElementById("report-message");
  if (title) title.textContent = config.title;
  if (description) description.textContent = config.description;
  if (message) message.textContent = "";
  syncReportFilterVisibility();
}

function configureReportAccess() {
  const cards = [...document.querySelectorAll(".report-type-card")];
  cards.forEach((card) => {
    const allowedRoles = (card.dataset.reportRoles || "").split(/\s+/);
    card.hidden = Boolean(managementRole) && !allowedRoles.includes(managementRole);
  });
  const selectedCard = cards.find(
    (card) => card.dataset.reportType === selectedReportType && !card.hidden,
  );
  const availableCard = selectedCard || cards.find((card) => !card.hidden);
  if (availableCard) selectReportType(availableCard.dataset.reportType);
}

async function loadReportDentists() {
  const select = document.getElementById("report-dentist-filter");
  if (!select) return;
  try {
    const response = await fetch("/api/dentists");
    const dentists = await response.json().catch(() => []);
    if (!response.ok || !Array.isArray(dentists)) return;
    dentists.forEach((dentist) => {
      const option = document.createElement("option");
      option.value = String(dentist.dentist_id);
      option.textContent = `Dr. ${dentist.first_name} ${dentist.last_name}`;
      select.appendChild(option);
    });
  } catch (error) {
    console.error(error);
  }
}

function buildReportQuery() {
  const form = document.getElementById("report-filter-form");
  const query = new URLSearchParams();
  if (!form) return query;
  new FormData(form).forEach((value, key) => {
    const normalized = String(value).trim();
    if (normalized) query.set(key, normalized);
  });
  query.set("limit", "10");
  return query;
}

function reportFilterSummary() {
  const form = document.getElementById("report-filter-form");
  if (!form) return "All records";
  const parts = [];
  form.querySelectorAll("input:not(:disabled), select:not(:disabled)").forEach(
    (control) => {
      if (!control.value) return;
      const label = form.querySelector(`label[for="${control.id}"]`)?.textContent;
      let value = control.value;
      if (control.type === "date") value = reportDisplayDate(value);
      if (control.tagName === "SELECT") {
        value = control.options[control.selectedIndex]?.textContent || value;
      }
      parts.push(`${label || control.name}: ${value}`);
    },
  );
  return parts.length ? parts.join(" • ") : "All records";
}

function renderReportTable(data) {
  const config = REPORT_CONFIG[selectedReportType];
  const head = document.getElementById("report-table-head");
  const body = document.getElementById("report-table-body");
  if (!config || !head || !body) return;

  head.replaceChildren();
  const headingRow = document.createElement("tr");
  config.columns.forEach((column) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = column.label;
    headingRow.appendChild(th);
  });
  head.appendChild(headingRow);

  body.replaceChildren();
  if (!data.rows?.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = config.columns.length;
    cell.textContent = "No records match the selected filters.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  data.rows.forEach((item) => {
    const row = document.createElement("tr");
    config.columns.forEach((column) => {
      const cell = document.createElement("td");
      cell.textContent = formatReportCell(item[column.key], column.format);
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
}

async function loadReport(page = 1) {
  const config = REPORT_CONFIG[selectedReportType];
  const message = document.getElementById("report-message");
  const generateButton = document.getElementById("report-generate-button");
  if (!config) return;
  const query = new URLSearchParams(reportLastQuery);
  query.set("page", String(page));
  if (message) message.textContent = "";
  if (generateButton) {
    generateButton.disabled = true;
    generateButton.textContent = "Generating...";
  }

  try {
    const response = await fetch(`${config.endpoint}?${query.toString()}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "Unable to generate the report.");
    }

    reportCurrentPage = Number(data.pagination?.page || 1);
    reportTotalPages = Number(data.pagination?.pages || 1);
    renderReportTable(data);
    document.getElementById("report-dialog-title").textContent =
      data.title || config.title;
    document.getElementById("report-dialog-filters").textContent =
      reportFilterSummary();
    const total = Number(data.pagination?.total || 0);
    document.getElementById("report-record-count").textContent =
      `${total} ${total === 1 ? "record" : "records"}`;
    document.getElementById("report-page-summary").textContent =
      `Page ${reportCurrentPage} of ${reportTotalPages}`;
    document.getElementById("report-previous-page").disabled =
      reportCurrentPage <= 1;
    document.getElementById("report-next-page").disabled =
      reportCurrentPage >= reportTotalPages;
    const dialog = document.getElementById("report-dialog");
    if (dialog && !dialog.open) dialog.showModal();
  } catch (error) {
    if (message) message.textContent = error.message;
  } finally {
    if (generateButton) {
      generateButton.disabled = false;
      generateButton.textContent = "Generate Report";
    }
  }
}

function initReportsTab() {
  const form = document.getElementById("report-filter-form");
  const dialog = document.getElementById("report-dialog");
  if (!form || !dialog) return;

  setDefaultReportDates();
  configureReportAccess();
  loadReportDentists();

  document.querySelectorAll(".report-type-card").forEach((card) => {
    card.addEventListener("click", () => {
      if (!card.hidden) selectReportType(card.dataset.reportType);
    });
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    reportLastQuery = buildReportQuery();
    await loadReport(1);
  });
  document.getElementById("report-reset-button")?.addEventListener("click", () => {
    form.reset();
    setDefaultReportDates();
    syncReportFilterVisibility();
    document.getElementById("report-message").textContent = "";
  });
  document.getElementById("report-previous-page")?.addEventListener("click", () => {
    if (reportCurrentPage > 1) loadReport(reportCurrentPage - 1);
  });
  document.getElementById("report-next-page")?.addEventListener("click", () => {
    if (reportCurrentPage < reportTotalPages) loadReport(reportCurrentPage + 1);
  });
  ["report-dialog-close", "report-dialog-close-icon"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", () => dialog.close());
  });
}
