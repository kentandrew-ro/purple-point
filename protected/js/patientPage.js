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

async function loadProfileRequirement() {
  const warning = document.getElementById("profile-required-message");
  if (!warning) return;
  try {
    const response = await fetch("/api/patients/me");
    const data = await response.json().catch(() => ({}));
    warning.hidden = response.ok && data.profileComplete;
  } catch {
    warning.hidden = false;
  }
}

function formatDateTime(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}`);
  const dateFmt = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${dateFmt} — ${timeFmt}`;
}

function statusLabel(status) {
  if (status === "no_show") return "Late / No Show";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

let selectedCancelAppointmentId = null;
let selectedCancelButton = null;

async function loadAppointments() {
  const table = document.getElementById("appointmentsTable");
  const empty = document.getElementById("appointmentsEmpty");
  const body = document.getElementById("appointmentsBody");

  try {
    const res = await fetch("/api/appointments");
    if (!res.ok) throw new Error("Failed to load appointments");
    const appointments = await res.json();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcoming = appointments
      .filter((a) => {
        if (a.appointment_status === "cancelled") return false;
        const apptDate = new Date(
          `${a.appointment_date}T${a.appointment_time}`,
        );
        return apptDate >= today;
      })
      .sort(
        (a, b) =>
          new Date(`${a.appointment_date}T${a.appointment_time}`) -
          new Date(`${b.appointment_date}T${b.appointment_time}`),
      );

    body.innerHTML = "";

    if (!upcoming.length) {
      empty.style.display = "block";
      table.style.display = "none";
      return;
    }

    empty.style.display = "none";
    table.style.display = "table";

    upcoming.forEach((appt) => {
      const tr = document.createElement("tr");
      tr.dataset.id = appt.appointment_id;
      const dateTimeCell = document.createElement("td");
      dateTimeCell.textContent = formatDateTime(
        appt.appointment_date,
        appt.appointment_time,
      );
      const doctorCell = document.createElement("td");
      doctorCell.textContent = appt.doctor_name || "—";
      const reasonCell = document.createElement("td");
      reasonCell.textContent = appt.reason_for_visit || appt.appointment_type;
      const statusCell = document.createElement("td");
      const status = [
        "scheduled",
        "completed",
        "cancelled",
        "no_show",
      ].includes(appt.appointment_status)
        ? appt.appointment_status
        : "scheduled";
      const statusBadge = document.createElement("span");
      statusBadge.className = `status status-${status}`;
      statusBadge.textContent = statusLabel(status);
      statusCell.appendChild(statusBadge);
      const actionCell = document.createElement("td");
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "cancel-btn";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", () => {
        const doctorLabel = appt.doctor_name
          ? ` with ${appt.doctor_name}`
          : "";
        openCancelModal(
          appt.appointment_id,
          `${formatDateTime(appt.appointment_date, appt.appointment_time)}${doctorLabel}`,
          cancelButton,
        );
      });
      actionCell.appendChild(cancelButton);
      tr.append(dateTimeCell, doctorCell, reasonCell, statusCell, actionCell);
      body.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    empty.textContent = "Could not load appointments.";
    empty.style.display = "block";
    table.style.display = "none";
  }
}

function openCancelModal(appointmentId, appointmentLabel, button) {
  selectedCancelAppointmentId = appointmentId;
  selectedCancelButton = button;
  const modal = document.getElementById("cancel-reason-modal");
  const title = document.getElementById("cancel-modal-title");
  const reasonInput = document.getElementById("cancel-reason-input");
  const result = document.getElementById("cancel-appointment-result");
  if (!modal || !title || !reasonInput || !result) return;

  title.textContent = appointmentLabel || `Appointment #${appointmentId}`;
  reasonInput.value = "";
  result.textContent = "";
  result.classList.remove("error", "success");
  modal.style.display = "flex";
  reasonInput.focus();
}

function closeCancelModal({ restoreFocus = true } = {}) {
  const modal = document.getElementById("cancel-reason-modal");
  const button = selectedCancelButton;
  if (modal) modal.style.display = "none";
  selectedCancelAppointmentId = null;
  selectedCancelButton = null;
  if (restoreFocus && button?.isConnected) button.focus();
}

async function submitAppointmentCancellation(event) {
  event.preventDefault();
  const appointmentId = selectedCancelAppointmentId;
  const reasonInput = document.getElementById("cancel-reason-input");
  const result = document.getElementById("cancel-appointment-result");
  const confirmButton = document.getElementById("confirm-cancel-btn");
  const closeButton = document.getElementById("close-cancel-modal-btn");
  const reason = reasonInput?.value.trim() || "";

  if (!appointmentId || !result || !confirmButton || !closeButton) return;
  if (!reason) {
    result.textContent = "Please enter a cancellation reason.";
    result.classList.add("error");
    reasonInput?.focus();
    return;
  }

  confirmButton.disabled = true;
  closeButton.disabled = true;
  confirmButton.textContent = "Cancelling...";
  result.textContent = "Cancelling appointment...";
  result.classList.remove("error", "success");

  try {
    const res = await fetch(`/api/appointments/${appointmentId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancel_reason: reason }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to cancel appointment.");
    }

    closeCancelModal({ restoreFocus: false });
    await loadAppointments();
  } catch (err) {
    console.error(err);
    result.textContent =
      err?.message || "Something went wrong cancelling the appointment.";
    result.classList.add("error");
  } finally {
    confirmButton.disabled = false;
    closeButton.disabled = false;
    confirmButton.textContent = "Confirm Cancellation";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const modal = document.getElementById("cancel-reason-modal");
  const form = document.getElementById("homepage-cancel-form");
  const closeButton = document.getElementById("close-cancel-modal-btn");
  form?.addEventListener("submit", submitAppointmentCancellation);
  closeButton?.addEventListener("click", () => closeCancelModal());
  modal?.addEventListener("click", (event) => {
    if (
      event.target === modal &&
      !document.getElementById("confirm-cancel-btn")?.disabled
    ) {
      closeCancelModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      modal?.style.display === "flex" &&
      !document.getElementById("confirm-cancel-btn")?.disabled
    ) {
      closeCancelModal();
    }
  });
});

window.addEventListener("pageshow", () => {
  loadProfileRequirement();
  loadAppointments();
});
