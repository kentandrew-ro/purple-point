require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

const DB_HOST = process.env.DB_HOST || "localhost";
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "purple_point";

const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  connectionLimit: 5,
  namedPlaceholders: true,
});

function requireField(obj, key) {
  const v = obj?.[key];
  if (v === undefined || v === null) return null;
  return String(v).trim();
}

function validateGender(gender) {
  const g = (gender || "").toLowerCase();
  if (!["male", "female"].includes(g)) return null;
  return g;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
  }),
);

/* ---------------- AUTH ---------------- */

app.post("/api/signup", async (req, res) => {
  const { firstName, lastName, username, email, password, contactNumber } =
    req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.execute(
      "INSERT INTO users (first_name, last_name, username, email, password_hash, contact_number) VALUES (?, ?, ?, ?, ?, ?)",
      [firstName, lastName, username, email, hashedPassword, contactNumber],
    );
    res.status(201).json({ message: "User registered successfully!" });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      res.status(409).json({ error: "Username or email already exists." });
    } else {
      console.error(error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
});

app.post("/api/login", async (req, res) => {
  const { identifier, password } = req.body;

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      "SELECT * FROM users WHERE username = ? OR email = ?",
      [identifier, identifier],
    );
    conn.release();

    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (match) {
      req.session.userId = user.user_id;
      req.session.role = user.role;
      res.status(200).json({ message: "Login successful!", role: user.role });
    } else {
      res.status(401).json({ error: "Invalid username or password." });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "Logged out successfully." });
  });
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  res.json({ userId: req.session.userId, role: req.session.role });
});

/* ---------------- PATIENTS ---------------- */

app.get("/api/patients/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const [rows] = await pool.execute(
      "SELECT * FROM patients WHERE user_id = ?",
      [req.session.userId],
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "No profile found" });
    }

    return res.json({ ok: true, patient: rows[0] });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.put("/api/patients/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const body = req.body || {};

    const first_name = requireField(body, "first_name");
    const last_name = requireField(body, "last_name");
    const date_of_birth = requireField(body, "date_of_birth");
    const gender = requireField(body, "gender");
    const contact_number = requireField(body, "contact_number");
    const house_no = requireField(body, "house_no");
    const street = requireField(body, "street");
    const barangay = requireField(body, "barangay");
    const city = requireField(body, "city");
    const zip_code = requireField(body, "zip_code");
    const blood_type = requireField(body, "blood_type");

    const missing = [];
    if (!first_name) missing.push("first_name");
    if (!last_name) missing.push("last_name");
    if (!date_of_birth) missing.push("date_of_birth");
    if (!gender) missing.push("gender");
    if (!contact_number) missing.push("contact_number");
    if (!house_no) missing.push("house_no");
    if (!street) missing.push("street");
    if (!barangay) missing.push("barangay");
    if (!city) missing.push("city");
    if (!zip_code) missing.push("zip_code");
    if (!blood_type) missing.push("blood_type");

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(", ")}` });
    }

    const normalizedGender = gender.toLowerCase();
    if (!["male", "female"].includes(normalizedGender)) {
      return res.status(400).json({ ok: false, error: "Invalid gender." });
    }

    const [existing] = await pool.execute(
      "SELECT patient_id FROM patients WHERE user_id = ?",
      [req.session.userId],
    );

    if (existing.length) {
      await pool.execute(
        `UPDATE patients SET
          first_name = ?, last_name = ?, date_of_birth = ?, gender = ?,
          contact_number = ?, house_no = ?, street = ?,
          barangay = ?, city = ?, zip_code = ?, blood_type = ?
        WHERE user_id = ?`,
        [
          first_name,
          last_name,
          date_of_birth,
          normalizedGender,
          contact_number,
          house_no,
          street,
          barangay,
          city,
          zip_code,
          blood_type,
          req.session.userId,
        ],
      );
    } else {
      await pool.execute(
        `INSERT INTO patients
          (user_id, first_name, last_name, date_of_birth, gender,
           contact_number, house_no, street, barangay, city, zip_code, blood_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.session.userId,
          first_name,
          last_name,
          date_of_birth,
          normalizedGender,
          contact_number,
          house_no,
          street,
          barangay,
          city,
          zip_code,
          blood_type,
        ],
      );
    }

    return res.json({ ok: true, message: "Profile saved successfully." });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.post("/api/patients", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const body = req.body || {};

    const first_name = requireField(body, "first_name") || requireField(body, "firstName");
    const last_name = requireField(body, "last_name") || requireField(body, "lastName");
    const date_of_birth = requireField(body, "date_of_birth") || requireField(body, "dob");
    const genderRaw = requireField(body, "gender") || requireField(body, "sex");
    const contact_number = requireField(body, "contact_number") || requireField(body, "contactNumber");
    const house_no = requireField(body, "house_no");
    const street = requireField(body, "street");
    const barangay = requireField(body, "barangay");
    const city = requireField(body, "city");
    const zip_code = requireField(body, "zip_code") || requireField(body, "zip");
    const blood_type = requireField(body, "blood_type");

    const gender = validateGender(genderRaw);

    const missing = [];
    if (!first_name) missing.push("first_name");
    if (!last_name) missing.push("last_name");
    if (!date_of_birth) missing.push("date_of_birth");
    if (!gender) missing.push("gender (male/female)");
    if (!contact_number) missing.push("contact_number");
    if (!house_no) missing.push("house_no");
    if (!street) missing.push("street");
    if (!barangay) missing.push("barangay");
    if (!city) missing.push("city");
    if (!zip_code) missing.push("zip_code");
    if (!blood_type) missing.push("blood_type");

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing required field(s): ${missing.join(", ")}` });
    }

    const [result] = await pool.execute(
      `INSERT INTO patients (
        first_name, last_name, date_of_birth, gender, contact_number,
        house_no, street, barangay, city, zip_code, blood_type
      ) VALUES (
          :first_name, :last_name, :date_of_birth, :gender, :contact_number,
          :house_no, :street, :barangay, :city, :zip_code, :blood_type
      )`,
      {
        first_name,
        last_name,
        date_of_birth,
        gender,
        contact_number,
        house_no,
        street,
        barangay,
        city,
        zip_code,
        blood_type,
      },
    );

    return res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

/* ---------------- STAFF (admin only) ---------------- */

app.post("/api/staff", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const body = req.body || {};

    const first_name = requireField(body, "first_name");
    const last_name = requireField(body, "last_name");
    const date_of_birth = requireField(body, "date_of_birth");
    const genderRaw = requireField(body, "gender");
    const contact_number = requireField(body, "contact_number");
    const email = requireField(body, "email");
    const shift_schedule = requireField(body, "shift_schedule");
    const hire_date = requireField(body, "hire_date");
    //const employment_status = requireField(body, "employment_status");

    const gender = validateGender(genderRaw);

    const missing = [];
    if (!first_name) missing.push("first_name");
    if (!last_name) missing.push("last_name");
    if (!date_of_birth) missing.push("date_of_birth");
    if (!gender) missing.push("gender (male/female)");
    if (!contact_number) missing.push("contact_number");
    if (!email) missing.push("email");
    if (!shift_schedule) missing.push("shift_schedule");
    if (!hire_date) missing.push("hire_date");
    //if (!employment_status) missing.push("employment_status");

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing required field(s): ${missing.join(", ")}` });
    }

    const [result] = await pool.execute(
      `INSERT INTO staff (
        first_name, last_name, date_of_birth, gender, contact_number,
        email, shift_schedule, hire_date
      ) VALUES (
        :first_name, :last_name, :date_of_birth, :gender, :contact_number,
        :email, :shift_schedule, :hire_date
      )`,
      {
        first_name,
        last_name,
        date_of_birth,
        gender,
        contact_number,
        email,
        shift_schedule,
        hire_date,
      },
    );

    return res.json({ ok: true, staff_id: result.insertId });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

/* ---------------- DOCTORS / DENTISTS (admin only) ---------------- */

app.post("/api/doctors", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const body = req.body || {};

    const first_name = requireField(body, "first_name");
    const last_name = requireField(body, "last_name");
    const date_of_birth = requireField(body, "date_of_birth");
    const genderRaw = requireField(body, "gender");
    const contact_number = requireField(body, "contact_number");
    const email = requireField(body, "email");
    const hire_date = requireField(body, "hire_date");
    const specialization = requireField(body, "specialization");
    const license_number_raw = requireField(body, "license_number");
    const license_number = license_number_raw ? Number(license_number_raw) : null;

    const gender = validateGender(genderRaw);

    const missing = [];
    if (!first_name) missing.push("first_name");
    if (!last_name) missing.push("last_name");
    if (!date_of_birth) missing.push("date_of_birth");
    if (!gender) missing.push("gender (male/female)");
    if (!contact_number) missing.push("contact_number");
    if (!email) missing.push("email");
    if (!hire_date) missing.push("hire_date");
    if (!specialization) missing.push("specialization");
    if (!license_number || Number.isNaN(license_number)) missing.push("license_number");

    if (missing.length) {
      await conn.rollback();
      return res
        .status(400)
        .json({ ok: false, error: `Missing required field(s): ${missing.join(", ")}` });
    }

    const [dentistResult] = await conn.execute(
      `INSERT INTO dentist (
        first_name, last_name, date_of_birth, gender, contact_number,
        email, specialization, license_number
      ) VALUES (
        :first_name, :last_name, :date_of_birth, :gender, :contact_number,
        :email, :specialization, :license_number
      )`,
      {
        first_name,
        last_name,
        date_of_birth,
        gender,
        contact_number,
        email,
        specialization,
        license_number,
      },
    );

    await conn.commit();
    return res.json({ ok: true, doctor_id: dentistResult.insertId });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {}
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  } finally {
    conn.release();
  }
});

app.post('/api/dentist-schedule', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  if (req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const body = req.body || {};
    const dentist_id = parseInt(requireField(body, 'dentist_id'), 10);
    const day_of_week = requireField(body, 'day_of_week');
    const start_time = requireField(body, 'start_time');
    const end_time = requireField(body, 'end_time');

    const missing = [];
    if (!dentist_id) missing.push('dentist_id');
    if (!day_of_week) missing.push('day_of_week');
    if (!start_time) missing.push('start_time');
    if (!end_time) missing.push('end_time');

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(', ')}` });
    }

    const validDays = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];
    if (!validDays.includes(day_of_week)) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid day_of_week.' });
    }

    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(start_time) || !timePattern.test(end_time)) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid start_time or end_time format.' });
    }

    if (start_time >= end_time) {
      return res
        .status(400)
        .json({ ok: false, error: 'Start time must be before end time.' });
    }

    const [dentists] = await pool.execute(
      'SELECT dentist_id FROM dentist WHERE dentist_id = ?',
      [dentist_id],
    );
    if (!dentists.length) {
      return res.status(404).json({ ok: false, error: 'Dentist not found.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO dentist_schedule
         (dentist_id, day_of_week, start_time, end_time)
       VALUES (?, ?, ?, ?)`,
      [dentist_id, day_of_week, start_time, end_time],
    );

    return res.status(201).json({ ok: true, schedule_id: result.insertId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || 'Database error' });
  }
});

/* ---------------- APPOINTMENTS ---------------- */

app.get("/api/appointments", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    let rows;

    if (req.session.role === "admin") {
      [rows] = await pool.execute(
        `SELECT
           a.appointment_id, a.patient_id,
           p.first_name, p.last_name,
           DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
           DATE_FORMAT(a.appointment_time, '%H:%i:%s') AS appointment_time,
           a.appointment_type, a.appointment_status,
           a.reason_for_visit, a.cancel_reason, a.created_at
         FROM appointments a
         JOIN patients p ON p.patient_id = a.patient_id
         ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
      );
    } else {
      [rows] = await pool.execute(
        `SELECT
           a.appointment_id, a.patient_id,
           p.first_name, p.last_name,
           DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
           DATE_FORMAT(a.appointment_time, '%H:%i:%s') AS appointment_time,
           a.appointment_type, a.appointment_status,
           a.reason_for_visit, a.cancel_reason, a.created_at
         FROM appointments a
         JOIN patients p ON p.patient_id = a.patient_id
         WHERE p.user_id = ?
         ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
        [req.session.userId],
      );
    }

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Database error" });
  }
});

app.post("/api/appointments", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const body = req.body || {};
    let patient_id;

    if (req.session.role === "admin") {
      patient_id = parseInt(body.patient_id, 10);
      if (!patient_id) {
        return res
          .status(400)
          .json({ ok: false, error: "Missing field(s): patient_id" });
      }
      const [patients] = await pool.execute(
        "SELECT patient_id FROM patients WHERE patient_id = ?",
        [patient_id],
      );
      if (!patients.length) {
        return res.status(404).json({ ok: false, error: "Patient not found." });
      }
    } else {
      const [rows] = await pool.execute(
        "SELECT patient_id FROM patients WHERE user_id = ?",
        [req.session.userId],
      );
      if (!rows.length) {
        return res.status(404).json({
          ok: false,
          error:
            "Patient profile not found. Please complete your profile first.",
        });
      }
      patient_id = rows[0].patient_id;
    }

    const appointment_date = requireField(body, "appointment_date");
    const appointment_time = requireField(body, "appointment_time");
    const appointment_type = requireField(body, "appointment_type");
    const appointment_status = requireField(body, "status");
    const reason_for_visit = requireField(body, "reason") || null;

    const missing = [];
    if (!appointment_date) missing.push("appointment_date");
    if (!appointment_time) missing.push("appointment_time");
    if (!appointment_type) missing.push("appointment_type");
    if (!appointment_status) missing.push("status");

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing field(s): ${missing.join(", ")}`,
      });
    }

    const validTypes = [
      "consultation",
      "cleaning",
      "filling",
      "extraction",
      "other",
    ];
    if (!validTypes.includes(appointment_type)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid appointment_type." });
    }

    const validStatuses = [
      "scheduled",
      "confirmed",
      "pending",
      "completed",
      "cancelled",
    ];
    if (!validStatuses.includes(appointment_status)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid appointment status." });
    }

    const [result] = await pool.execute(
      `INSERT INTO appointments
         (patient_id, appointment_date, appointment_time,
          appointment_type, appointment_status, reason_for_visit)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        patient_id,
        appointment_date,
        appointment_time,
        appointment_type,
        appointment_status,
        reason_for_visit,
      ],
    );

    return res.status(201).json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.post("/api/appointments/:id/cancel", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const appointmentId = parseInt(req.params.id, 10);
  if (!appointmentId) {
    return res
      .status(400)
      .json({ ok: false, error: "Invalid appointment ID." });
  }

  const cancel_reason = requireField(req.body || {}, "cancel_reason");
  if (!cancel_reason) {
    return res
      .status(400)
      .json({ ok: false, error: "cancel_reason is required." });
  }

  try {
    const [existing] = await pool.execute(
      "SELECT appointment_id, appointment_status FROM appointments WHERE appointment_id = ?",
      [appointmentId],
    );

    if (!existing.length) {
      return res
        .status(404)
        .json({ ok: false, error: "Appointment not found." });
    }

    if (existing[0].appointment_status === "cancelled") {
      return res
        .status(409)
        .json({ ok: false, error: "Appointment is already cancelled." });
    }

    if (req.session.role !== "admin") {
      const [ownership] = await pool.execute(
        `SELECT a.appointment_id
         FROM appointments a
         JOIN patients p ON p.patient_id = a.patient_id
         WHERE a.appointment_id = ? AND p.user_id = ?`,
        [appointmentId, req.session.userId],
      );
      if (!ownership.length) {
        return res.status(403).json({
          ok: false,
          error: "You can only cancel your own appointments.",
        });
      }
    }

    await pool.execute(
      `UPDATE appointments
       SET appointment_status = 'cancelled', cancel_reason = ?
       WHERE appointment_id = ?`,
      [cancel_reason, appointmentId],
    );

    return res.json({ ok: true, message: "Appointment cancelled." });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

/* ---------------- DASHBOARD ---------------- */

app.get("/api/dashboard/stats", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  try {
    const [[{ total_patients }]] = await pool.execute(
      "SELECT COUNT(*) AS total_patients FROM patients",
    );

    const [[{ appointments_today }]] = await pool.execute(
      `SELECT COUNT(*) AS appointments_today
       FROM appointments
       WHERE appointment_date = CURDATE()
         AND appointment_status != 'cancelled'`,
    );

    const [[{ pending_review }]] = await pool.execute(
      `SELECT COUNT(*) AS pending_review
       FROM appointments
       WHERE appointment_status IN ('scheduled', 'pending')`,
    );

    return res.json({
      total_patients,
      appointments_today,
      pending_review,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Database error" });
  }
});

app.get("/api/dashboard/schedule", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  try {
    const [rows] = await pool.execute(
      `SELECT
         DATE_FORMAT(a.appointment_time, '%h:%i %p')                          AS time,
         CONCAT(p.first_name, ' ', p.last_name)                               AS patient,
         COALESCE(NULLIF(a.reason_for_visit, ''), a.appointment_type)         AS reason,
         a.appointment_status                                                  AS status,
         a.appointment_id
       FROM appointments a
       JOIN patients p ON p.patient_id = a.patient_id
       WHERE a.appointment_date = CURDATE()
         AND a.appointment_status != 'cancelled'
       ORDER BY a.appointment_time ASC`,
    );

    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Database error" });
  }
});

app.get("/api/admin/users/search", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Forbidden" });

  try {
    const q = requireField(req.query, "q");
    if (!q) return res.json([]);

    const search = `%${q}%`;
    const [rows] = await pool.execute(
      `SELECT u.user_id, u.first_name, u.last_name, u.username, u.email, u.contact_number,
              p.date_of_birth, p.gender
         FROM users u
         LEFT JOIN patients p ON p.user_id = u.user_id
        WHERE (
            u.first_name LIKE ?
            OR u.last_name LIKE ?
            OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?
            OR u.username LIKE ?
            OR u.email LIKE ?
            OR u.contact_number LIKE ?
          )
        LIMIT 12`,
      [search, search, search, search, search, search],
    );

    return res.json(
      rows.map((row) => ({
        user_id: row.user_id,
        first_name: row.first_name,
        last_name: row.last_name,
        username: row.username,
        email: row.email,
        contact_number: row.contact_number,
        date_of_birth: row.date_of_birth,
        gender: row.gender,
      })),
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Database error" });
  }
});

/* ---------------- PATIENTS (admin search) ---------------- */
app.get('/api/patients/search', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const q = requireField(req.query, 'q');
    if (!q) return res.json([]);
    const search = `%${q}%`;
    const [rows] = await pool.execute(
      `SELECT
         p.patient_id,
         p.first_name,
         p.last_name,
         p.contact_number,
         u.email
       FROM patients p
       LEFT JOIN users u ON u.user_id = p.user_id
       WHERE p.first_name LIKE ?
          OR p.last_name LIKE ?
          OR CONCAT(p.first_name, ' ', p.last_name) LIKE ?
          OR u.email LIKE ?
          OR p.contact_number LIKE ?
       LIMIT 12`,
      [search, search, search, search, search],
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || 'Database error' });
  }
});

app.get('/api/patients/:id', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  const patientId = parseInt(req.params.id, 10);
  if (!patientId) {
    return res.status(400).json({ ok: false, error: 'Invalid patient ID.' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
         p.patient_id, p.user_id, p.first_name, p.last_name,
         p.date_of_birth, p.gender, p.contact_number,
         p.house_no, p.street, p.barangay, p.city, p.zip_code,
         p.blood_type, p.created_at, u.email
       FROM patients p
       LEFT JOIN users u ON u.user_id = p.user_id
       WHERE p.patient_id = ?`,
      [patientId],
    );

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'Patient not found.' });
    }

    const [[appointmentCountRow]] = await pool.execute(
      'SELECT COUNT(*) AS appointment_count FROM appointments WHERE patient_id = ?',
      [patientId],
    );

    return res.json({
      ok: true,
      patient: {
        ...rows[0],
        appointment_count: appointmentCountRow?.appointment_count || 0,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || 'Database error' });
  }
});

/* ---------------- DENTISTS (admin search) ---------------- */
app.get('/api/dentists/search', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });

  try {
    const q = requireField(req.query, 'q');
    if (!q) return res.json([]);
    const search = `%${q}%`;
    const [rows] = await pool.execute(
      `SELECT dentist_id, first_name, last_name, specialization, email
         FROM dentist
        WHERE first_name LIKE ? OR last_name LIKE ? OR CONCAT(first_name, ' ', last_name) LIKE ? OR email LIKE ? OR specialization LIKE ?
        LIMIT 12`,
      [search, search, search, search, search],
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || 'Database error' });
  }
});

app.get("/api/admin/users/summary", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Forbidden" });

  try {
    const [[{ total_doctors }]] = await pool.execute(
      "SELECT COUNT(*) AS total_doctors FROM dentist",
    );
    const [[{ total_staff }]] = await pool.execute(
      "SELECT COUNT(*) AS total_staff FROM staff",
    );
    const [doctors] = await pool.execute(
      `SELECT dentist_id, first_name, last_name, specialization
         FROM dentist
        ORDER BY created_at DESC
        LIMIT 5`,
    );
    const [staff] = await pool.execute(
      `SELECT staff_id, first_name, last_name, shift_schedule
         FROM staff
        ORDER BY created_at DESC
        LIMIT 5`,
    );

    return res.json({
      total_doctors,
      total_staff,
      doctors: doctors.map((row) => ({
        id: row.dentist_id,
        name: `${row.first_name} ${row.last_name}`,
        specialization: row.specialization,
      })),
      staff: staff.map((row) => ({
        id: row.staff_id,
        name: `${row.first_name} ${row.last_name}`,
        shift_schedule: row.shift_schedule,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Database error" });
  }
});

app.post("/api/admin/users/promote", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin") return res.status(403).json({ error: "Forbidden" });

  try {
    const body = req.body || {};
    const user_id = parseInt(requireField(body, "user_id"), 10);
    const role = requireField(body, "role");
    const hire_date = requireField(body, "hire_date");
    const specialization = requireField(body, "specialization");
    const license_number_raw = requireField(body, "license_number");
    const license_number = license_number_raw ? Number(license_number_raw) : null;
    const employment_status = requireField(body, "employment_status") || "Active";
    const shift_schedule = requireField(body, "shift_schedule");
    const missing = [];
    if (!user_id) missing.push("user_id");
    if (!role) missing.push("role");
    if (!hire_date) missing.push("hire_date");
    if (role === "doctor") {
      if (!specialization) missing.push("specialization");
      if (!license_number_raw || Number.isNaN(license_number)) missing.push("license_number");
    }
    if (role === "staff") {
      if (!shift_schedule) missing.push("shift_schedule");
    }

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(", ")}` });
    }

    if (!["doctor", "staff"].includes(role)) {
      return res.status(400).json({ ok: false, error: "Invalid role." });
    }

    // Fetch only from users table — do not require a patients record.
    const [users] = await pool.execute(
      `SELECT user_id, first_name, last_name, email, contact_number, role
         FROM users
        WHERE user_id = ?`,
      [user_id],
    );

    if (!users.length) {
      return res.status(404).json({ ok: false, error: "User not found." });
    }

    const user = users[0];

    // allow optional demographic overrides from the request body; otherwise use safe defaults
    const date_of_birth = requireField(body, 'date_of_birth') || '1970-01-01';
    const gender = requireField(body, 'gender') || 'male';

    if (role === "doctor") {
      const [existing] = await pool.execute(
        "SELECT dentist_id FROM dentist WHERE email = ? OR (first_name = ? AND last_name = ?)",
        [user.email, user.first_name, user.last_name],
      );
      if (existing.length) {
        return res.status(409).json({ ok: false, error: "This user already has a doctor profile." });
      }

      const [result] = await pool.execute(
        `INSERT INTO dentist (
           first_name, last_name, date_of_birth, gender, contact_number,
           email, specialization, license_number
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.first_name,
          user.last_name,
          date_of_birth,
          gender,
          user.contact_number || '',
          user.email,
          specialization,
          license_number,
        ],
      );

      await pool.execute("UPDATE users SET role = 'admin' WHERE user_id = ?", [user_id]);
      return res.json({ ok: true, doctor_id: result.insertId, role: "doctor" });
    }

    const [existingStaff] = await pool.execute(
      "SELECT staff_id FROM staff WHERE email = ? OR (first_name = ? AND last_name = ?)",
      [user.email, user.first_name, user.last_name],
    );
    if (existingStaff.length) {
      return res.status(409).json({ ok: false, error: "This user already has a staff profile." });
    }

    const [result] = await pool.execute(
      `INSERT INTO staff (
         first_name, last_name, date_of_birth, gender, contact_number,
         email, shift_schedule, hire_date, employment_status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.first_name,
        user.last_name,
        date_of_birth,
        gender,
        user.contact_number || '',
        user.email,
        shift_schedule,
        hire_date,
        employment_status,
      ],
    );

    await pool.execute("UPDATE users SET role = 'admin' WHERE user_id = ?", [user_id]);
    return res.json({ ok: true, staff_id: result.insertId, role: "staff" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || "Database error" });
  }
});

/* ---------------- PROTECTED PAGES ---------------- */

app.get("/patientPage.html", (req, res) => {
  if (!req.session.userId) return res.redirect("/login.html");
  if (req.session.role !== "patient") return res.redirect("/adminPage.html");
  res.sendFile(
    path.join(__dirname, "protected", "patient", "patientPage.html"),
  );
});

app.get("/js/patientPage.js", (req, res) => {
  if (!req.session.userId) return res.status(401).send("Unauthorized");
  res.sendFile(path.join(__dirname, "protected", "js", "patientPage.js"));
});

app.get("/adminPage.html", (req, res) => {
  if (!req.session.userId) return res.redirect("/login.html");
  if (req.session.role !== "admin") return res.redirect("/patientPage.html");
  res.sendFile(path.join(__dirname, "protected", "admin", "adminPage.html"));
});

app.get("/profile.html", (req, res) => {
  if (!req.session.userId) return res.redirect("/login.html");
  if (req.session.role !== "patient") return res.redirect("/adminPage.html");
  res.sendFile(path.join(__dirname, "protected", "patient", "profile.html"));
});

app.get("/appointments.html", (req, res) => {
  if (!req.session.userId) return res.redirect("/login.html");
  res.sendFile(
    path.join(__dirname, "protected", "patient", "appointments.html"),
  );
});

app.get("/js/profile.js", (req, res) => {
  if (!req.session.userId) return res.status(401).send("Unauthorized");
  res.sendFile(path.join(__dirname, "protected", "js", "profile.js"));
});

app.get("/js/appointments.js", (req, res) => {
  if (!req.session.userId) return res.status(401).send("Unauthorized");
  res.sendFile(path.join(__dirname, "protected", "js", "appointments.js"));
});

app.get("/js/adminPage.js", (req, res) => {
  if (!req.session.userId) return res.status(401).send("Unauthorized");
  if (req.session.role !== "admin") return res.status(403).send("Forbidden");
  res.sendFile(path.join(__dirname, "protected", "js", "adminPage.js"));
});

// DB init <---------------------------------------------------------------
async function ensureDbInitialized() {
  const bootstrapConn = await mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  });

  try {
    await bootstrapConn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await bootstrapConn.end();
  }


  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      username VARCHAR(100) NOT NULL UNIQUE,
      email VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      contact_number VARCHAR(30),
      role ENUM('patient', 'admin') NOT NULL DEFAULT 'patient',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS patients (
      patient_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      date_of_birth DATE NOT NULL,
      gender ENUM('male', 'female') NOT NULL,
      contact_number VARCHAR(30) NOT NULL,
      email VARCHAR(150) NOT NULL,
      house_no VARCHAR(50) NOT NULL,
      street VARCHAR(150) NOT NULL,
      barangay VARCHAR(150) NOT NULL,
      city VARCHAR(100) NOT NULL,
      zip_code VARCHAR(20) NOT NULL,
      blood_type VARCHAR(5) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_patients_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      appointment_id INT AUTO_INCREMENT PRIMARY KEY,
      patient_id INT NOT NULL,
      appointment_date DATE NOT NULL,
      appointment_time TIME NOT NULL,
      appointment_type ENUM('consultation', 'cleaning', 'filling', 'extraction', 'other') NOT NULL,
      appointment_status ENUM('scheduled', 'confirmed', 'pending', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
      reason_for_visit VARCHAR(255) NULL,
      cancel_reason VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_appointments_patient
        FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff (
      staff_id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      date_of_birth DATE NOT NULL,
      gender ENUM('male', 'female') NOT NULL,
      contact_number VARCHAR(30) NOT NULL,
      email VARCHAR(150) NOT NULL,
      shift_schedule VARCHAR(100) NOT NULL,
      hire_date DATE NOT NULL,
      employment_status ENUM('Active', 'On-leave', 'Terminated') NOT NULL DEFAULT 'Active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dentist (
      dentist_id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      date_of_birth DATE NOT NULL,
      gender ENUM('male', 'female') NOT NULL,
      contact_number VARCHAR(30) NOT NULL,
      email VARCHAR(150) NOT NULL,
      specialization VARCHAR(150) NOT NULL,
      license_number INT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dentist_schedule (
      schedule_id INT AUTO_INCREMENT PRIMARY KEY,
      dentist_id INT NOT NULL,
      day_of_week ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_dentist_schedule_dentist
        FOREIGN KEY (dentist_id) REFERENCES dentist(dentist_id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  console.log("Database initialized successfully.");
}

ensureDbInitialized()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });