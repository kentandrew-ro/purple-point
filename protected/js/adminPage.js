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

function getFormPayload(form, extra = {}) {
  const payload = { ...extra };
  const fd = new FormData(form);
  for (const [k, v] of fd.entries()) {
    payload[k] = typeof v === 'string' ? v.trim() : v;
  }
  return payload;
}

function genderNormalize(gender) {
  const g = (gender || '').toLowerCase();
  if (g === 'male' || g === 'm') return 'male';
  if (g === 'female' || g === 'f') return 'female';
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
  if (!user) return '';
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return `${name} · ${user.email || user.username || ''}`;
}

function clearUserSuggestions() {
  const list = document.getElementById('user-suggestions');
  if (list) list.innerHTML = '';
}

function renderUserSuggestions(users) {
  const list = document.getElementById('user-suggestions');
  if (!list) return;

  if (!users || !users.length) {
    list.innerHTML = '<div style="padding:10px;color:#666;">No users found.</div>';
    return;
  }

  list.innerHTML = users
    .map(
      (user) =>
        `<div class="suggestion-item" data-user-id="${user.user_id}">${formatUserLabel(user)}</div>`,
    )
    .join('');
}

function renderPatientSuggestions(patients) {
  const list = document.getElementById('patient-suggestions');
  if (!list) return;
  if (!patients || !patients.length) {
    list.innerHTML = '<div style="padding:10px;color:#666;">No patients found.</div>';
    return;
  }
  list.innerHTML = patients
    .map((p) => `<div class="suggestion-item" data-patient-id="${p.patient_id}">${p.first_name} ${p.last_name} · ${p.email || p.contact_number || ''}</div>`)
    .join('');
}

function renderDentistSuggestions(dentists, target) {
  const list = document.getElementById(target);
  if (!list) return;
  if (!dentists || !dentists.length) {
    list.innerHTML = '<div style="padding:10px;color:#666;">No dentists found.</div>';
    return;
  }
  list.innerHTML = dentists
    .map((d) => `<div class="suggestion-item" data-dentist-id="${d.dentist_id}">${d.first_name} ${d.last_name} · ${d.specialization || d.email || ''}</div>`)
    .join('');
}

function updateSelectedUserCard(user) {
  const card = document.getElementById('selected-user-card');
  const nameEl = document.getElementById('selected-user-name');
  const emailEl = document.getElementById('selected-user-email');
  const roleEl = document.getElementById('selected-user-role');

  if (!card || !nameEl || !emailEl || !roleEl) return;

  if (!user) {
    card.style.display = 'none';
    nameEl.textContent = '';
    emailEl.textContent = '';
    roleEl.textContent = '';
    return;
  }

  card.style.display = 'block';
  nameEl.textContent = `${user.first_name} ${user.last_name}`.trim();
  emailEl.textContent = user.email || '';
  roleEl.textContent = `Current role: ${user.role || 'patient'}`;
}

async function searchUsers(query) {
  if (!query || query.trim().length < 1) {
    clearUserSuggestions();
    return;
  }

  try {
    const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    const users = await res.json();
    renderUserSuggestions(users);
  } catch (err) {
    console.error(err);
    renderUserSuggestions([]);
  }
}

async function searchPatients(query) {
  if (!query || query.trim().length < 1) {
    const list = document.getElementById('patient-suggestions'); if (list) list.innerHTML = '';
    return;
  }
  try {
    const res = await fetch(`/api/patients/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    const items = await res.json();
    renderPatientSuggestions(items);
  } catch (err) {
    console.error(err);
    renderPatientSuggestions([]);
  }
}

async function searchDentists(query, targetListId) {
  if (!query || query.trim().length < 1) {
    const list = document.getElementById(targetListId); if (list) list.innerHTML = '';
    return;
  }
  try {
    const res = await fetch(`/api/dentists/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    const items = await res.json();
    renderDentistSuggestions(items, targetListId);
  } catch (err) {
    console.error(err);
    renderDentistSuggestions([], targetListId);
  }
}

function showRoleSpecificFields() {
  const role = document.getElementById('promote-role')?.value;
  const doctorExtra = document.getElementById('doctor-extra');
  const staffExtra = document.getElementById('staff-extra');
  const extraWrapper = document.getElementById('role-extra-fields');

  if (!extraWrapper) return;

  if (role === 'doctor') {
    extraWrapper.style.display = 'block';
    if (doctorExtra) doctorExtra.style.display = 'block';
    if (staffExtra) staffExtra.style.display = 'none';
  } else if (role === 'staff') {
    extraWrapper.style.display = 'block';
    if (doctorExtra) doctorExtra.style.display = 'none';
    if (staffExtra) staffExtra.style.display = 'block';
  } else {
    extraWrapper.style.display = 'none';
    if (doctorExtra) doctorExtra.style.display = 'none';
    if (staffExtra) staffExtra.style.display = 'none';
  }
}

async function promoteSelectedUser() {
  const userId = document.getElementById('selected-user-id')?.value;
  const role = document.getElementById('promote-role')?.value;
  const resultBox = document.getElementById('promote-result');
  const submitBtn = document.getElementById('promote-user-button');

  if (submitBtn) submitBtn.disabled = true;
  showResult(resultBox, 'Promoting user...');

  try {
    if (!userId || !role) {
      throw new Error('Please select a user and role before promoting.');
    }

    const payload = {
      user_id: Number(userId),
      role,
      hire_date: document.getElementById('promote_hire_date')?.value,
      specialization: document.getElementById('specialization')?.value,
      license_number: document.getElementById('license_number')?.value,
      shift_schedule: document.getElementById('shift_schedule')?.value,
    };

    const res = await fetch('/api/admin/users/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Failed to promote user.');
    }

    showResult(
      resultBox,
      `<h3>User promoted successfully!</h3><p>New ${data.role} profile created: ID ${data.doctor_id || data.staff_id}.</p>`,
    );
    loadDoctorStaffSummaries();
    document.getElementById('user-search').value = '';
    document.getElementById('selected-user-id').value = '';
    updateSelectedUserCard(null);
    clearUserSuggestions();
    document.getElementById('promote-role').value = '';
    showRoleSpecificFields();
  } catch (err) {
    showResult(resultBox, `<h3 style="color:red;">Error</h3><p>${err?.message || 'Unknown error'}</p>`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadDoctorStaffSummaries() {
  const doctorCount = document.getElementById('doctor-summary-count');
  const staffCount = document.getElementById('staff-summary-count');
  const doctorList = document.getElementById('doctor-summary-list');
  const staffList = document.getElementById('staff-summary-list');

  if (doctorCount) doctorCount.textContent = '...';
  if (staffCount) staffCount.textContent = '...';
  if (doctorList) doctorList.innerHTML = 'Loading...';
  if (staffList) staffList.innerHTML = 'Loading...';

  try {
    const res = await fetch('/api/admin/users/summary');
    if (!res.ok) throw new Error('Failed to load summaries');
    const data = await res.json();

    if (doctorCount) doctorCount.textContent = String(data.total_doctors ?? 0);
    if (staffCount) staffCount.textContent = String(data.total_staff ?? 0);
    if (doctorList)
      doctorList.innerHTML =
        data.doctors?.length > 0
          ? data.doctors.map((item) => `<div>${item.name} — ${item.specialization}</div>`).join('')
          : '<div style="color:#666;">No doctors yet.</div>';
    if (staffList)
      staffList.innerHTML =
        data.staff?.length > 0
          ? data.staff.map((item) => `<div>${item.name} — ${item.shift_schedule}</div>`).join('')
          : '<div style="color:#666;">No staff yet.</div>';
  } catch (err) {
    console.error(err);
    if (doctorCount) doctorCount.textContent = '0';
    if (staffCount) staffCount.textContent = '0';
    if (doctorList) doctorList.innerHTML = '<div style="color:red;">Unable to load doctor summary.</div>';
    if (staffList) staffList.innerHTML = '<div style="color:red;">Unable to load staff summary.</div>';
  }
}

function bindUserSuggestionClicks(event) {
  const item = event.target.closest('.suggestion-item');
  if (!item) return;

  const userId = item.dataset.userId;
  const query = item.textContent || '';
  const userText = query.trim();
  const [namePart, emailPart] = userText.split('·').map((part) => part.trim());

  document.getElementById('selected-user-id').value = userId;
  document.getElementById('user-search').value = namePart || emailPart || userText;
  updateSelectedUserCard({
    first_name: namePart,
    last_name: '',
    email: emailPart || '',
    role: 'patient',
  });
  clearUserSuggestions();
}

function submitAppointmentForm(event) {
  if (typeof handleAddSubmit === 'function') {
    return handleAddSubmit(event);
  }
  event.preventDefault();
  console.error('handleAddSubmit is not defined');
}

function showResult(el, html) {
  if (!el) return;
  el.innerHTML = html;
}

async function submitBlockDatesForm(e) {
  e.preventDefault();
  const resultBox = document.getElementById('block-sched-result');
  showResult(
    resultBox,
    `<h3>Not implemented yet</h3><p>Block dates/leave scheduling is not available yet.</p>`,
  );
}

async function submitClinicHoursForm(e) {
  e.preventDefault();
  const form = e.target;
  const resultBox = document.getElementById('clinic-hours-result');
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  showResult(resultBox, 'Saving clinic hours...');

  try {
    const payload = getFormPayload(form);
    const missing = [];
    if (!payload.dentist_id) missing.push('dentist_id');
    if (!payload.day_of_week) missing.push('day_of_week');
    if (!payload.start_time) missing.push('start_time');
    if (!payload.end_time) missing.push('end_time');

    if (missing.length) {
      throw new Error(`Missing field(s): ${missing.join(', ')}`);
    }

    if (payload.start_time >= payload.end_time) {
      throw new Error('Start time must be before end time.');
    }

    const res = await fetch('/api/dentist-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Failed to save clinic hours');
    }

    showResult(
      resultBox,
      `<h3>Clinic hours saved successfully!</h3><p>Schedule ID: ${data.schedule_id ?? 'N/A'}</p>`,
    );
    form.reset();
  } catch (err) {
    showResult(resultBox, `<h3 style="color:red;">Error</h3><p>${err?.message || 'Unknown error'}</p>`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function submitStaffForm(e) {
  e.preventDefault();

  const form = e.target;
  const resultBox = document.getElementById('staff-form-result');
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  showResult(resultBox, 'Saving staff...');

  try {
    const payload = getFormPayload(form);
    payload.gender = genderNormalize(payload.gender);

    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Failed to add staff');
    }

    showResult(resultBox, `
      <h3>Staff saved successfully!</h3>
      <p>Staff ID: ${data.staff_id}</p>
      <p>Inserted Staff User ID: ${data.user_id ?? 'N/A'}</p>
    `);

    form.reset();
  } catch (err) {
    showResult(resultBox, `<h3 style="color:red;">Database Error</h3><p>${err?.message ? String(err.message) : 'Unknown error'}</p>`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function submitDoctorForm(e) {
  e.preventDefault();

  const form = e.target;
  const resultBox = document.getElementById('doctor-form-result');
  const submitBtn = form.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  showResult(resultBox, 'Saving doctor...');

  try {
    const payload = getFormPayload(form);
    payload.gender = genderNormalize(payload.gender);
    payload.employment_status = 'Active';
    payload.license_number = payload.license_number === '' ? null : Number(payload.license_number);


    const res = await fetch('/api/doctors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Failed to add doctor');
    }

    showResult(resultBox, `
      <h3>Doctor saved successfully!</h3>
      <p>Doctor ID: ${data.doctor_id ?? 'N/A'}</p>
    `);

    form.reset();
  } catch (err) {
    showResult(resultBox, `<h3 style="color:red;">Database Error</h3><p>${err?.message ? String(err.message) : 'Unknown error'}</p>`);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const btnDoctor = document.getElementById('btn-show-doctor');
  const btnStaff = document.getElementById('btn-show-staff');
  const doctorCard = document.getElementById('doctor-form-card');
  const staffCard = document.getElementById('staff-form-card');
  const btnAppointment = document.getElementById('btn-show-add');
  const btnBlockDates = document.getElementById('btn-show-view');
  const btnClinicHours = document.getElementById('btn-show-cancel');
  const appointmentCard = document.getElementById('appointment-form-card');
  const blockDatesCard = document.getElementById('block-dates-form-card');
  const clinicHoursCard = document.getElementById('clinic-hours-form-card');

  function showDoctorForm() {
    if (doctorCard) doctorCard.style.display = 'block';
    if (staffCard) staffCard.style.display = 'none';
  }

  function showStaffForm() {
    if (doctorCard) doctorCard.style.display = 'none';
    if (staffCard) staffCard.style.display = 'block';
  }

  function showAppointmentForm() {
    if (appointmentCard) appointmentCard.style.display = 'block';
    if (blockDatesCard) blockDatesCard.style.display = 'none';
    if (clinicHoursCard) clinicHoursCard.style.display = 'none';
  }

  function showBlockDatesForm() {
    if (appointmentCard) appointmentCard.style.display = 'none';
    if (blockDatesCard) blockDatesCard.style.display = 'block';
    if (clinicHoursCard) clinicHoursCard.style.display = 'none';
  }

  function showClinicHoursForm() {
    if (appointmentCard) appointmentCard.style.display = 'none';
    if (blockDatesCard) blockDatesCard.style.display = 'none';
    if (clinicHoursCard) clinicHoursCard.style.display = 'block';
  }

  if (btnDoctor) btnDoctor.addEventListener('click', showDoctorForm);
  if (btnStaff) btnStaff.addEventListener('click', showStaffForm);
  if (btnAppointment) btnAppointment.addEventListener('click', showAppointmentForm);
  if (btnBlockDates) btnBlockDates.addEventListener('click', showBlockDatesForm);
  if (btnClinicHours) btnClinicHours.addEventListener('click', showClinicHoursForm);

  const doctorForm = document.getElementById('doctor-form');
  const staffForm = document.getElementById('staff-form');
  const appointmentForm = document.getElementById('add-appointment-form');
  const blockDatesForm = document.getElementById('block-sched-form');
  const clinicHoursForm = document.getElementById('clinic-hours-form');

  if (doctorForm) doctorForm.addEventListener('submit', submitDoctorForm);
  if (staffForm) staffForm.addEventListener('submit', submitStaffForm);
  if (appointmentForm)
    appointmentForm.addEventListener(
      'submit',
      typeof handleAddSubmit === 'function' ? handleAddSubmit : submitAppointmentForm,
    );
  if (blockDatesForm) blockDatesForm.addEventListener('submit', submitBlockDatesForm);
  if (clinicHoursForm) clinicHoursForm.addEventListener('submit', submitClinicHoursForm);

  const userSearchInput = document.getElementById('user-search');
  const userSuggestions = document.getElementById('user-suggestions');
  const promoteRole = document.getElementById('promote-role');
  const promoteButton = document.getElementById('promote-user-button');

  if (userSearchInput) {
    userSearchInput.addEventListener(
      'input',
      debounce((event) => searchUsers(event.target.value || ''), 250),
    );
  }

  const patientSearch = document.getElementById('patient-search');
  const patientSuggestions = document.getElementById('patient-suggestions');
  if (patientSearch) {
    patientSearch.addEventListener('input', debounce((e) => searchPatients(e.target.value || ''), 200));
  }
  if (patientSuggestions) {
    patientSuggestions.addEventListener('click', (e) => {
      const el = e.target.closest('.suggestion-item'); if (!el) return;
      const id = el.dataset.patientId; const label = el.textContent || '';
      document.getElementById('patient_id').value = id;
      document.getElementById('patient-search').value = label.split('·')[0].trim();
      patientSuggestions.innerHTML = '';
    });
  }

  const clinicDentistSearch = document.getElementById('clinic-dentist-search');
  const clinicDentistSuggestions = document.getElementById('clinic-dentist-suggestions');
  if (clinicDentistSearch) {
    clinicDentistSearch.addEventListener('input', debounce((e) => searchDentists(e.target.value || '', 'clinic-dentist-suggestions'), 200));
  }
  if (clinicDentistSuggestions) {
    clinicDentistSuggestions.addEventListener('click', (e) => {
      const el = e.target.closest('.suggestion-item'); if (!el) return;
      const id = el.dataset.dentistId; const label = el.textContent || '';
      document.getElementById('clinic_dentist_id').value = id;
      document.getElementById('clinic-dentist-search').value = label.split('·')[0].trim();
      clinicDentistSuggestions.innerHTML = '';
    });
  }

  const blockDentistSearch = document.getElementById('block-dentist-search');
  const blockDentistSuggestions = document.getElementById('block-dentist-suggestions');
  if (blockDentistSearch) {
    blockDentistSearch.addEventListener('input', debounce((e) => searchDentists(e.target.value || '', 'block-dentist-suggestions'), 200));
  }
  if (blockDentistSuggestions) {
    blockDentistSuggestions.addEventListener('click', (e) => {
      const el = e.target.closest('.suggestion-item'); if (!el) return;
      const id = el.dataset.dentistId; const label = el.textContent || '';
      document.getElementById('block_dentist_id').value = id;
      document.getElementById('block-dentist-search').value = label.split('·')[0].trim();
      blockDentistSuggestions.innerHTML = '';
    });
  }

  if (userSuggestions) {
    userSuggestions.addEventListener('click', bindUserSuggestionClicks);
  }

  if (promoteRole) {
    promoteRole.addEventListener('change', showRoleSpecificFields);
  }

  if (promoteButton) {
    promoteButton.addEventListener('click', promoteSelectedUser);
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#user-search') && !event.target.closest('#user-suggestions')) {
      clearUserSuggestions();
    }
  });

  loadDoctorStaffSummaries();
});

