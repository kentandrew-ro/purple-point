"use strict";

const APPOINTMENT_DRAFT_FIELDS = [
  "appointment_date",
  "appointment_type",
  "dentist_id",
  "reason_for_visit",
];

let appointmentDraftKey = null;
let dentistScheduleRequestId = 0;

function readAppointmentDraft() {
  if (!appointmentDraftKey) return {};
  try {
    return JSON.parse(localStorage.getItem(appointmentDraftKey) || "{}");
  } catch {
    return {};
  }
}

function restoreAppointmentDraft(form) {
  const draft = readAppointmentDraft();
  APPOINTMENT_DRAFT_FIELDS.forEach((name) => {
    if (form.elements[name] && draft[name] !== undefined) {
      form.elements[name].value = draft[name];
    }
  });
}

function autosaveAppointmentDraft(form) {
  if (!appointmentDraftKey) return;
  const draft = {};
  APPOINTMENT_DRAFT_FIELDS.forEach((name) => {
    draft[name] = form.elements[name]?.value || "";
  });
  try {
    localStorage.setItem(appointmentDraftKey, JSON.stringify(draft));
    const resultBox = document.getElementById("add-appointment-result");
    resultBox.textContent = "Appointment details saved automatically on this device.";
    resultBox.classList.remove("error", "success");
  } catch {}
}

function blockAppointmentBookingUntilProfileIsComplete() {
  const warning = document.getElementById("appointment-profile-warning");
  const addButton = document.getElementById("btn-add");
  if (warning) warning.hidden = false;
  if (addButton) {
    addButton.disabled = true;
    addButton.setAttribute(
      "aria-describedby",
      "appointment-profile-warning",
    );
  }
}

function showView(id) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function parseAppointmentDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");

  return {
    appointment_date: `${year}-${month}-${day}`,
    appointment_time: `${hours}:${mins}:00`,
  };
}

function localDateTimeInputValue(date = new Date()) {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function setAppointmentDateMinimum(form) {
  const input = form?.elements?.appointment_date;
  if (input) input.min = localDateTimeInputValue();
}

function parseDateOnly(dateVal) {
  if (!dateVal) return null;

  let iso;
  if (
    typeof dateVal === "object" &&
    typeof dateVal.toISOString === "function"
  ) {
    iso = dateVal.toISOString().slice(0, 10);
  } else {
    iso = String(dateVal).slice(0, 10);
  }

  const parts = iso.split("-").map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return null;
  return { year: parts[0], month: parts[1] - 1, day: parts[2] };
}

function formatTimeLabel(timeStr) {
  if (!timeStr) return "";
  const [h, m] = String(timeStr).split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  const min = String(m).padStart(2, "0");
  return `${hour}:${min} ${ampm}`;
}

function formatAppointmentLabel(appt) {
  const first = (appt.first_name || "").trim();
  const last = (appt.last_name || "").trim();
  const initials = first ? `${first[0].toUpperCase()}.` : "";
  const timeLabel = formatTimeLabel(appt.appointment_time);
  const status =
    appt.appointment_status === "no_show"
      ? "late / no show"
      : appt.appointment_status || "";
  const namePart = `${initials} ${last}`.trim();

  let label = namePart;
  if (timeLabel) label += ` — ${timeLabel}`;
  if (status) label += ` — ${status}`;
  return label;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getCancellableAppointments(appointments) {
  const activeStatuses = new Set(["scheduled"]);
  return (appointments || []).filter((appt) => {
    const status = String(appt.appointment_status || "").toLowerCase();
    return activeStatuses.has(status);
  });
}

function renderCancelAppointmentList(appointments, container) {
  const cancellable = getCancellableAppointments(appointments);

  if (!cancellable.length) {
    container.innerHTML =
      '<p style="color:#666;">No scheduled appointments to cancel.</p>';
    return;
  }

  const rows = cancellable
    .map((appt) => {
      const dateLabel = appt.appointment_date
        ? new Date(`${appt.appointment_date}T00:00:00`).toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "Date unavailable";
      const timeLabel = formatTimeLabel(appt.appointment_time);
      const status = escapeHtml(appt.appointment_status || "scheduled");
      const title = escapeHtml(
        `${appt.first_name || ""} ${appt.last_name || ""}`.trim() ||
          `Appointment #${appt.appointment_id}`,
      );

      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #eee;">
          <div>
            <div style="font-weight:700;">${title}</div>
            <div style="font-size:14px;color:#666;">${escapeHtml(dateLabel)}${timeLabel ? ` • ${escapeHtml(timeLabel)}` : ""}</div>
            <div style="font-size:13px;color:#888;">Status: ${status}</div>
          </div>
          <button
            type="button"
            data-appointment-id="${escapeHtml(appt.appointment_id)}"
            data-appointment-label="${escapeHtml(`Appointment #${appt.appointment_id} (${dateLabel}${timeLabel ? ` ${timeLabel}` : ""})`)}"
            style="padding:8px 12px;border:1px solid #c0392b;background:#fff;color:#c0392b;border-radius:6px;cursor:pointer;"
          >
            Cancel
          </button>
        </div>
      `;
    })
    .join("");

  container.innerHTML = rows;

  container
    .querySelectorAll("button[data-appointment-id]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        openCancelModal(
          button.getAttribute("data-appointment-id"),
          button.getAttribute("data-appointment-label"),
        );
      });
    });
}

let selectedAppointmentId = null;

function openCancelModal(appointmentId, appointmentLabel) {
  selectedAppointmentId = appointmentId;
  const modal = document.getElementById("cancel-reason-modal");
  const title = document.getElementById("cancel-modal-title");
  const reasonInput = document.getElementById("cancel-reason-input");
  if (modal && title && reasonInput) {
    title.textContent = appointmentLabel || `Appointment #${appointmentId}`;
    reasonInput.value = "";
    modal.style.display = "flex";
    reasonInput.focus();
  }
}

function closeCancelModal() {
  const modal = document.getElementById("cancel-reason-modal");
  if (modal) modal.style.display = "none";
}

function renderAppointmentsCalendar(
  appointments,
  container,
  baseDate = new Date(),
) {
  if (!container.__apptsCalendarState) container.__apptsCalendarState = {};
  container.__apptsCalendarState.base = new Date(baseDate);

  const currentYear = baseDate.getFullYear();
  const currentMonth = baseDate.getMonth();

  const filtered = (appointments || []).filter((a) => {
    const parts = parseDateOnly(a.appointment_date);
    return parts && parts.year === currentYear && parts.month === currentMonth;
  });

  const byDay = new Map();
  filtered.forEach((a) => {
    const parts = parseDateOnly(a.appointment_date);
    if (!parts) return;
    if (!byDay.has(parts.day)) byDay.set(parts.day, []);
    byDay.get(parts.day).push(a);
  });

  const monthLabel = baseDate.toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const startWeekday = new Date(currentYear, currentMonth, 1).getDay();

  container.innerHTML = `
    <div style="margin-top:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <button type="button" id="cal-prev" class="appointment-calendar-nav"
          aria-label="Previous month" title="Previous month">&lt;</button>
        <div style="font-weight:700;font-size:15px;">${monthLabel}</div>
        <button type="button" id="cal-next" class="appointment-calendar-nav"
          aria-label="Next month" title="Next month">&gt;</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);">
        ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
          .map(
            (d) =>
              `<div style="padding:6px 8px;font-size:12px;font-weight:700;color:#666;border-bottom:1px solid #eee;">${d}</div>`,
          )
          .join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);" id="cal-body"></div>
      ${!appointments.length ? '<p style="margin-top:12px;color:#888;">No saved appointments found.</p>' : ""}
    </div>
  `;

  container.querySelector("#cal-prev").addEventListener("click", () => {
    renderAppointmentsCalendar(
      appointments,
      container,
      new Date(currentYear, currentMonth - 1, 1),
    );
  });
  container.querySelector("#cal-next").addEventListener("click", () => {
    renderAppointmentsCalendar(
      appointments,
      container,
      new Date(currentYear, currentMonth + 1, 1),
    );
  });

  const calBody = container.querySelector("#cal-body");

  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement("div");
    empty.style.cssText =
      "min-height:92px;border:1px solid #eee;background:#fafafa;";
    calBody.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    cell.style.cssText =
      "min-height:92px;border:1px solid #eee;padding:6px;box-sizing:border-box;display:flex;flex-direction:column;overflow:auto;";

    const dayNum = document.createElement("div");
    dayNum.style.cssText = "font-weight:800;font-size:12px;margin-bottom:4px;";
    dayNum.textContent = day;
    cell.appendChild(dayNum);

    const items = (byDay.get(day) || []).sort((a, b) =>
      (a.appointment_time || "").localeCompare(b.appointment_time || ""),
    );

    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:4px;";

    if (items.length) {
      items.slice(0, 4).forEach((appt) => {
        const rawStatus = String(
          appt.appointment_status || "",
        ).toLowerCase();
        const status = [
          "scheduled",
          "completed",
          "cancelled",
          "no_show",
        ].includes(
          rawStatus,
        )
          ? rawStatus
          : "scheduled";
        const tag = document.createElement("div");
        tag.className = `appointment-calendar-event appointment-calendar-event--${status}`;
        tag.style.cssText =
          "font-size:11px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:3px;padding:2px 4px;";
        tag.textContent = formatAppointmentLabel(appt);
        if (status === "cancelled" && appt.cancel_reason) {
          tag.title = `Cancellation reason: ${appt.cancel_reason}`;
        }
        list.appendChild(tag);
      });
      if (items.length > 4) {
        const more = document.createElement("div");
        more.style.cssText = "font-size:11px;color:#666;";
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

async function loadAppointments() {
  const response = await fetch("/api/appointments");
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to load appointments");
  }
  return response.json();
}

async function loadDentists(dateTimeValue, appointmentType) {
  const dateParts = parseAppointmentDateTime(dateTimeValue);
  if (!dateParts || !appointmentType) return [];

  const params = new URLSearchParams({
    appointment_date: dateParts.appointment_date,
    appointment_time: dateParts.appointment_time,
    appointment_type: appointmentType,
  });
  const response = await fetch(`/api/dentists?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to load dentists");
  }
  return response.json();
}

async function loadDentistSchedules(selectedDentistId = "") {
  const container = document.getElementById("dentist-schedule-sidebar");
  if (!container) return;

  const requestId = ++dentistScheduleRequestId;
  container.textContent = "Loading schedules...";
  try {
    const params = new URLSearchParams();
    if (selectedDentistId) params.set("dentist_id", selectedDentistId);
    const query = params.toString();
    const response = await fetch(
      `/api/dentists/schedules${query ? `?${query}` : ""}`,
    );
    const rows = await response.json().catch(() => []);
    if (!response.ok) {
      throw new Error(rows.error || "Unable to load dentist schedules.");
    }
    if (requestId !== dentistScheduleRequestId) return;

    const dentists = new Map();
    rows.forEach((row) => {
      const key = String(row.dentist_id);
      if (!dentists.has(key)) {
        dentists.set(key, { ...row, schedules: [] });
      }
      if (row.day_of_week) dentists.get(key).schedules.push(row);
    });

    if (!dentists.size) {
      container.innerHTML = "<p>No active dentist schedules are available.</p>";
      return;
    }

    container.innerHTML = [...dentists.values()]
      .map((dentist) => {
        const isSelected =
          String(dentist.dentist_id) === String(selectedDentistId);
        const schedules = dentist.schedules.length
          ? `<ul class="dentist-schedule-hours">${dentist.schedules
              .map(
                (schedule) =>
                  `<li>${escapeHtml(schedule.day_of_week)}: ${escapeHtml(formatTimeLabel(schedule.start_time))}–${escapeHtml(formatTimeLabel(schedule.end_time))}</li>`,
              )
              .join("")}</ul>`
          : '<p class="form-hint">No regular hours set.</p>';
        return `<section class="dentist-schedule-card${isSelected ? " is-selected" : ""}">
          <strong>Dr. ${escapeHtml(`${dentist.first_name} ${dentist.last_name}`)}</strong>
          <small>${escapeHtml(dentist.specialization || "General dentistry")}</small>
          ${schedules}
        </section>`;
      })
      .join("");
  } catch (error) {
    if (requestId !== dentistScheduleRequestId) return;
    container.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function populateDentistDropdown() {
  const form = document.getElementById("add-appointment-form");
  const select = form?.elements?.dentist_id;
  const dateTimeValue = form?.elements?.appointment_date?.value || "";
  const appointmentType = form?.elements?.appointment_type?.value || "";
  if (!select) return;

  if (!dateTimeValue || !appointmentType) {
    const instruction = !dateTimeValue && !appointmentType
      ? "Choose an appointment type and date/time first"
      : !appointmentType
        ? "Choose an appointment type first"
        : "Choose a date and time first";
    select.innerHTML = `<option value="">${instruction}</option>`;
    select.disabled = true;
    loadDentistSchedules("");
    return;
  }

  const currentValue = select.value || readAppointmentDraft().dentist_id || "";
  select.disabled = true;
  select.innerHTML = '<option value="">Loading available doctors...</option>';

  try {
    const dentists = await loadDentists(dateTimeValue, appointmentType);
    if (
      form.elements.appointment_date.value !== dateTimeValue ||
      form.elements.appointment_type.value !== appointmentType
    ) {
      return;
    }
    select.innerHTML = dentists.length
      ? '<option value="">Select an available doctor</option>'
      : '<option value="">No available doctors match this type and time</option>';
    dentists.forEach((dentist) => {
      const option = document.createElement("option");
      option.value = dentist.dentist_id;
      const name = `${dentist.first_name} ${dentist.last_name}`;
      const specialty = dentist.specialization
        ? ` (${dentist.specialization})`
        : "";
      option.textContent = `${name}${specialty}`;
      select.appendChild(option);
    });
    select.disabled = dentists.length === 0;
    if (dentists.some((dentist) => String(dentist.dentist_id) === currentValue)) {
      select.value = currentValue;
    }
    loadDentistSchedules(select.value);
  } catch (err) {
    console.error("Failed to load dentists:", err);
    select.innerHTML = '<option value="">Unable to load available doctors</option>';
    select.disabled = true;
  }
}

async function handleAddSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const resultBox = document.getElementById("add-appointment-result");
  resultBox.innerHTML = "";

  const dateParts = parseAppointmentDateTime(form.appointment_date.value);
  if (
    dateParts &&
    new Date(form.appointment_date.value).getTime() < Date.now()
  ) {
    resultBox.innerHTML =
      '<p style="color:red;">Choose the present time or a future date and time.</p>';
    form.appointment_date.focus();
    return;
  }

  const patientIdField = document.getElementById("patient-id-field");
  const isAdminField =
    patientIdField &&
    window.getComputedStyle(patientIdField).display !== "none";

  const payload = {
    appointment_date: dateParts?.appointment_date || "",
    appointment_time: dateParts?.appointment_time || "",
    appointment_type: form.appointment_type.value,
    status: isAdminField ? form.appointment_status.value : "scheduled",
    reason: form.reason_for_visit.value.trim() || null,
    dentist_id: form.dentist_id.value
      ? parseInt(form.dentist_id.value, 10)
      : null,
  };

  if (isAdminField) {
    payload.patient_id = Number(form.patient_id.value);
  }

  const missing = [];
  if (isAdminField && !payload.patient_id) missing.push("patient_id");
  if (!payload.appointment_date || !payload.appointment_time)
    missing.push("appointment_date");
  if (!payload.appointment_type) missing.push("appointment_type");
  if (!payload.dentist_id) missing.push("dentist_id");
  if (!payload.status) missing.push("status");

  if (missing.length) {
    resultBox.innerHTML = `<p style="color:red;">Please complete the following: ${missing.join(", ")}</p>`;
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    resultBox.textContent = "Saving appointment…";

    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok)
      throw new Error(data.error || "Failed to add appointment");

    resultBox.innerHTML = `
      <h2>Appointment saved successfully!</h2>
      <p>Appointment ID: ${escapeHtml(data.id)}</p>
      <p>Date: ${escapeHtml(payload.appointment_date)}</p>
      <p>Time: ${escapeHtml(payload.appointment_time)}</p>
      <p>Status: ${escapeHtml(payload.status)}</p>
      <button type="button" id="add-back-success">Back to options</button>
    `;
    document
      .getElementById("add-back-success")
      .addEventListener("click", () => showView("view-choose"));
    if (appointmentDraftKey) localStorage.removeItem(appointmentDraftKey);
    form.reset();
    populateDentistDropdown();
  } catch (err) {
    resultBox.innerHTML = `<h2>Error</h2><p>${escapeHtml(err?.message || "Unknown error")}</p>`;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleCancelSubmit(event) {
  event?.preventDefault?.();

  const resultBox = document.getElementById("cancel-appointment-result");
  const reasonInput = document.getElementById("cancel-reason-input");
  const cancelReason = reasonInput?.value?.trim() || "";
  const appointmentId = selectedAppointmentId;

  resultBox.innerHTML = "";

  if (!appointmentId) {
    resultBox.innerHTML =
      '<p style="color:red;">Please select an appointment first.</p>';
    return;
  }

  if (!cancelReason) {
    resultBox.innerHTML =
      '<p style="color:red;">Please enter a cancellation reason.</p>';
    return;
  }

  const confirmBtn = document.getElementById("confirm-cancel-btn");
  if (confirmBtn) confirmBtn.disabled = true;
  resultBox.textContent = "Cancelling appointment…";

  try {
    const response = await fetch(
      `/api/appointments/${encodeURIComponent(appointmentId)}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel_reason: cancelReason }),
      },
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok)
      throw new Error(data.error || "Failed to cancel appointment");

    closeCancelModal();
    resultBox.innerHTML = `
      <h2>Appointment Cancelled</h2>
      <p>Appointment ID: ${escapeHtml(appointmentId)}</p>
      <p>Reason: ${escapeHtml(cancelReason)}</p>
      <button type="button" id="cancel-back-success">Back to options</button>
    `;

    const listBox = document.getElementById("cancel-appointment-list");
    const appointments = await loadAppointments();
    renderCancelAppointmentList(appointments, listBox);

    document
      .getElementById("cancel-back-success")
      ?.addEventListener("click", () => showView("view-choose"));
  } catch (err) {
    resultBox.innerHTML = `<h2>Error</h2><p>${escapeHtml(err?.message || "Unknown error")}</p>`;
  } finally {
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  let currentUser = null;
  try {
    const meRes = await fetch("/api/me");
    if (meRes.ok) {
      currentUser = await meRes.json();
      if (
        ["superadmin", "staff", "doctor", "admin"].includes(currentUser.role)
      ) {
        const field = document.getElementById("patient-id-field");
        if (field) field.style.display = "block";
        const input = field?.querySelector("input");
        if (input) input.required = true;

        const statusField = document.getElementById("appointment-status-field");
        if (statusField) statusField.style.display = "block";
      } else if (currentUser.role === "patient") {
        appointmentDraftKey = `purplepoint:appointment-draft:${currentUser.userId}`;

        const profileResponse = await fetch("/api/patients/me");
        const profileData = await profileResponse.json().catch(() => ({}));
        if (!profileResponse.ok || !profileData.profileComplete) {
          blockAppointmentBookingUntilProfileIsComplete();
        }
      }
    }
  } catch {
    if (!currentUser || currentUser.role === "patient") {
      blockAppointmentBookingUntilProfileIsComplete();
    }
  }

  const addForm = document.getElementById("add-appointment-form");
  if (addForm) {
    setAppointmentDateMinimum(addForm);
    restoreAppointmentDraft(addForm);
    await populateDentistDropdown();
    await loadDentistSchedules(addForm.elements.dentist_id?.value || "");
    addForm.addEventListener("submit", handleAddSubmit);
    addForm.addEventListener("input", (event) => {
      autosaveAppointmentDraft(addForm);
    });
    addForm.addEventListener("change", (event) => {
      autosaveAppointmentDraft(addForm);
      if (
        event.target?.name === "appointment_date" ||
        event.target?.name === "appointment_type"
      ) {
        populateDentistDropdown();
      }
      if (event.target?.name === "dentist_id") {
        loadDentistSchedules(event.target.value);
      }
    });
  }

  document.getElementById("btn-add")?.addEventListener("click", () => {
    showView("view-add");
    populateDentistDropdown();
  });

  document.getElementById("btn-view")?.addEventListener("click", async () => {
    showView("view-view");
    const resultBox = document.getElementById("view-appointment-result");
    resultBox.textContent = "Loading appointments…";
    try {
      const appointments = await loadAppointments();
      renderAppointmentsCalendar(appointments, resultBox);
    } catch (err) {
      resultBox.innerHTML = `<h2>Error</h2><p>${escapeHtml(err?.message || "Unable to load appointments.")}</p>`;
    }
  });

  document.getElementById("btn-cancel")?.addEventListener("click", async () => {
    showView("view-cancel");
    const listBox = document.getElementById("cancel-appointment-list");
    const resultBox = document.getElementById("cancel-appointment-result");
    if (listBox) {
      listBox.innerHTML = "<p>Loading appointments…</p>";
    }
    resultBox.innerHTML = "";

    try {
      const appointments = await loadAppointments();
      renderCancelAppointmentList(appointments, listBox);
    } catch (err) {
      if (listBox) {
        listBox.innerHTML = `<h2>Error</h2><p>${escapeHtml(err?.message || "Unable to load appointments.")}</p>`;
      }
    }
  });

  document
    .getElementById("back-from-view")
    ?.addEventListener("click", () => showView("view-choose"));

  document
    .getElementById("back-from-add")
    ?.addEventListener("click", () => showView("view-choose"));

  document
    .getElementById("back-from-cancel")
    ?.addEventListener("click", () => showView("view-choose"));
  document
    .getElementById("confirm-cancel-btn")
    ?.addEventListener("click", handleCancelSubmit);
  document
    .getElementById("close-cancel-modal-btn")
    ?.addEventListener("click", closeCancelModal);
  document
    .getElementById("cancel-reason-modal")
    ?.addEventListener("click", (event) => {
      if (event.target.id === "cancel-reason-modal") closeCancelModal();
    });

  if (new URLSearchParams(window.location.search).get("view") === "1") {
    showView("view-view");
    const resultBox = document.getElementById("view-appointment-result");
    if (resultBox) {
      loadAppointments()
        .then((appts) => renderAppointmentsCalendar(appts, resultBox))
        .catch((err) => {
          resultBox.innerHTML = `<h2>Error</h2><p>${escapeHtml(err?.message || "Unable to load appointments.")}</p>`;
        });
    }
  }
});
