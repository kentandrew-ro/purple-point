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
  return status.charAt(0).toUpperCase() + status.slice(1);
}

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
      const status = ["scheduled", "completed", "cancelled"].includes(
        appt.appointment_status,
      )
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
      cancelButton.addEventListener("click", () =>
        cancelAppointment(appt.appointment_id, cancelButton),
      );
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

async function cancelAppointment(appointmentId, btn) {
  const reason = window.prompt(
    "Please provide a reason for cancelling this appointment:",
  );
  if (reason === null) return;
  if (!reason.trim()) {
    alert("A cancellation reason is required.");
    return;
  }

  const confirmed = confirm(
    "Are you sure you want to cancel this appointment?",
  );
  if (!confirmed) return;

  btn.disabled = true;
  btn.textContent = "Cancelling...";

  try {
    const res = await fetch(`/api/appointments/${appointmentId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cancel_reason: reason.trim() }),
    });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      alert(data.error || "Failed to cancel appointment.");
      btn.disabled = false;
      btn.textContent = "Cancel";
      return;
    }

    loadAppointments();
  } catch (err) {
    console.error(err);
    alert("Something went wrong cancelling the appointment.");
    btn.disabled = false;
    btn.textContent = "Cancel";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadProfileRequirement();
  loadAppointments();
});
