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

function parseDateOnly(dateVal) {
  if (!dateVal) return null;

  // Normalize to YYYY-MM-DD regardless of whether the driver returns a
  // Date object or a string like "2026-06-30T00:00:00.000Z".
  // toISOString() is always UTC, so slicing gives the correct date.
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
  const status = appt.appointment_status || "";
  const namePart = `${initials} ${last}`.trim();

  let label = namePart;
  if (timeLabel) label += ` — ${timeLabel}`;
  if (status) label += ` — ${status}`;
  return label;
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
  const startWeekday = new Date(currentYear, currentMonth, 1).getDay(); // 0 = Sun

  container.innerHTML = `
    <div style="margin-top:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <button type="button" id="cal-prev" style="border:1px solid #ddd;background:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:16px;">&#8249;</button>
        <div style="font-weight:700;font-size:15px;">${monthLabel}</div>
        <button type="button" id="cal-next" style="border:1px solid #ddd;background:#fff;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:16px;">&#8250;</button>
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

  // Empty cells before the 1st
  for (let i = 0; i < startWeekday; i++) {
    const empty = document.createElement("div");
    empty.style.cssText =
      "min-height:92px;border:1px solid #eee;background:#fafafa;";
    calBody.appendChild(empty);
  }

  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    cell.style.cssText =
      "min-height:92px;border:1px solid #eee;padding:6px;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;";

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
        const tag = document.createElement("div");
        tag.style.cssText =
          "font-size:11px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:#e8f0fe;border-radius:3px;padding:2px 4px;";
        tag.textContent = formatAppointmentLabel(appt);
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

async function handleAddSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const resultBox = document.getElementById("add-appointment-result");
  resultBox.innerHTML = "";

  const dateParts = parseAppointmentDateTime(form.appointment_date.value);

  const patientIdField = document.getElementById("patient-id-field");
  const isAdminField =
    patientIdField &&
    window.getComputedStyle(patientIdField).display !== "none";

  const payload = {
    appointment_date: dateParts?.appointment_date || "",
    appointment_time: dateParts?.appointment_time || "",
    appointment_type: form.appointment_type.value,
    status: form.appointment_status.value,
    reason: form.reason_for_visit.value.trim() || null,
  };

  if (isAdminField) {
    payload.patient_id = Number(form.patient_id.value);
  }

  const missing = [];
  if (isAdminField && !payload.patient_id) missing.push("patient_id");
  if (!payload.appointment_date || !payload.appointment_time)
    missing.push("appointment_date");
  if (!payload.appointment_type) missing.push("appointment_type");
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
      <p>Appointment ID: ${data.id}</p>
      <p>Date: ${payload.appointment_date}</p>
      <p>Time: ${payload.appointment_time}</p>
      <p>Status: ${payload.status}</p>
      <button type="button" id="add-back-success">Back to options</button>
    `;
    document
      .getElementById("add-back-success")
      .addEventListener("click", () => showView("view-choose"));
    form.reset();
  } catch (err) {
    resultBox.innerHTML = `<h2>Error</h2><p>${err?.message || "Unknown error"}</p>`;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function handleCancelSubmit(event) {
  event.preventDefault();

  const form = event.target;
  const resultBox = document.getElementById("cancel-appointment-result");
  const appointmentId = form.appointment_id.value.trim();
  const cancelReason = form.cancel_reason.value.trim();
  resultBox.innerHTML = "";

  if (!appointmentId || !cancelReason) {
    resultBox.innerHTML =
      '<p style="color:red;">Enter both appointment_id and cancel_reason.</p>';
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
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

    resultBox.innerHTML = `
      <h2>Appointment Cancelled</h2>
      <p>Appointment ID: ${appointmentId}</p>
      <p>Reason: ${cancelReason}</p>
      <button type="button" id="cancel-back-success">Back to options</button>
    `;
    document
      .getElementById("cancel-back-success")
      .addEventListener("click", () => showView("view-choose"));
    form.reset();
  } catch (err) {
    resultBox.innerHTML = `<h2>Error</h2><p>${err?.message || "Unknown error"}</p>`;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const meRes = await fetch("/api/me");
    if (meRes.ok) {
      const me = await meRes.json();
      if (me.role === "admin") {
        const field = document.getElementById("patient-id-field");
        if (field) field.style.display = "block";
        const input = field?.querySelector("input");
        if (input) input.required = true;
      }
    }
  } catch {}

  document
    .getElementById("btn-add")
    ?.addEventListener("click", () => showView("view-add"));

  document.getElementById("btn-view")?.addEventListener("click", async () => {
    showView("view-view");
    const resultBox = document.getElementById("view-appointment-result");
    resultBox.textContent = "Loading appointments…";
    try {
      const appointments = await loadAppointments();
      renderAppointmentsCalendar(appointments, resultBox);
    } catch (err) {
      resultBox.innerHTML = `<h2>Error</h2><p>${err?.message || "Unable to load appointments."}</p>`;
    }
  });

  document
    .getElementById("btn-cancel")
    ?.addEventListener("click", () => showView("view-cancel"));

  document
    .getElementById("back-from-view")
    ?.addEventListener("click", () => showView("view-choose"));

  const addForm = document.getElementById("add-appointment-form");
  if (addForm) addForm.addEventListener("submit", handleAddSubmit);
  document
    .getElementById("back-from-add")
    ?.addEventListener("click", () => showView("view-choose"));

  const cancelForm = document.getElementById("cancel-appointment-form");
  if (cancelForm) cancelForm.addEventListener("submit", handleCancelSubmit);
  document
    .getElementById("back-from-cancel")
    ?.addEventListener("click", () => showView("view-choose"));

  if (new URLSearchParams(window.location.search).get("view") === "1") {
    showView("view-view");
    const resultBox = document.getElementById("view-appointment-result");
    if (resultBox) {
      loadAppointments()
        .then((appts) => renderAppointmentsCalendar(appts, resultBox))
        .catch((err) => {
          resultBox.innerHTML = `<h2>Error</h2><p>${err?.message || "Unable to load appointments."}</p>`;
        });
    }
  }
});
