require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
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

    const first_name =
      requireField(body, "first_name") || requireField(body, "firstName");
    const last_name =
      requireField(body, "last_name") || requireField(body, "lastName");
    const date_of_birth =
      requireField(body, "date_of_birth") || requireField(body, "dob");
    const genderRaw = requireField(body, "gender") || requireField(body, "sex");
    const contact_number =
      requireField(body, "contact_number") ||
      requireField(body, "contactNumber");
    const house_no = requireField(body, "house_no");
    const street = requireField(body, "street");
    const barangay = requireField(body, "barangay");
    const city = requireField(body, "city");
    const zip_code =
      requireField(body, "zip_code") || requireField(body, "zip");
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
      return res.status(400).json({
        ok: false,
        error: `Missing required field(s): ${missing.join(", ")}`,
      });
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

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required field(s): ${missing.join(", ")}`,
      });
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
    const license_number = license_number_raw
      ? Number(license_number_raw)
      : null;

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
    if (!license_number || Number.isNaN(license_number))
      missing.push("license_number");

    if (missing.length) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: `Missing required field(s): ${missing.join(", ")}`,
      });
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

app.post("/api/dentist-schedule", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const body = req.body || {};
    const dentist_id = parseInt(requireField(body, "dentist_id"), 10);
    const day_of_week = requireField(body, "day_of_week");
    const start_time = requireField(body, "start_time");
    const end_time = requireField(body, "end_time");

    const missing = [];
    if (!dentist_id) missing.push("dentist_id");
    if (!day_of_week) missing.push("day_of_week");
    if (!start_time) missing.push("start_time");
    if (!end_time) missing.push("end_time");

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(", ")}` });
    }

    const validDays = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
    if (!validDays.includes(day_of_week)) {
      return res.status(400).json({ ok: false, error: "Invalid day_of_week." });
    }

    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(start_time) || !timePattern.test(end_time)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid start_time or end_time format." });
    }

    if (start_time >= end_time) {
      return res
        .status(400)
        .json({ ok: false, error: "Start time must be before end time." });
    }

    const [dentists] = await pool.execute(
      "SELECT dentist_id FROM dentist WHERE dentist_id = ?",
      [dentist_id],
    );
    if (!dentists.length) {
      return res.status(404).json({ ok: false, error: "Dentist not found." });
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
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

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
           d.dentist_id,
           CONCAT('Dr. ', d.first_name, ' ', d.last_name) AS doctor_name,
           DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
           DATE_FORMAT(a.appointment_time, '%H:%i:%s') AS appointment_time,
           a.appointment_type, a.appointment_status,
           a.reason_for_visit, a.cancel_reason, a.created_at
         FROM appointments a
         JOIN patients p ON p.patient_id = a.patient_id
         LEFT JOIN dentist d ON d.dentist_id = a.dentist_id
         ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
      );
    } else {
      [rows] = await pool.execute(
        `SELECT
           a.appointment_id, a.patient_id,
           p.first_name, p.last_name,
           d.dentist_id,
           CONCAT('Dr. ', d.first_name, ' ', d.last_name) AS doctor_name,
           DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
           DATE_FORMAT(a.appointment_time, '%H:%i:%s') AS appointment_time,
           a.appointment_type, a.appointment_status,
           a.reason_for_visit, a.cancel_reason, a.created_at
         FROM appointments a
         JOIN patients p ON p.patient_id = a.patient_id
         LEFT JOIN dentist d ON d.dentist_id = a.dentist_id
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
    const dentist_id_raw = requireField(body, "dentist_id");
    const dentist_id = dentist_id_raw ? parseInt(dentist_id_raw, 10) : null;

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

    if (dentist_id_raw && !dentist_id) {
      return res.status(400).json({ ok: false, error: "Invalid dentist_id." });
    }

    if (dentist_id) {
      const [dentists] = await pool.execute(
        "SELECT dentist_id FROM dentist WHERE dentist_id = ?",
        [dentist_id],
      );
      if (!dentists.length) {
        return res.status(404).json({ ok: false, error: "Dentist not found." });
      }
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
         (patient_id, dentist_id, appointment_date, appointment_time,
          appointment_type, appointment_status, reason_for_visit)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        patient_id,
        dentist_id,
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

app.patch("/api/appointments/:id/status", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const appointmentId = parseInt(req.params.id, 10);
  if (!appointmentId) {
    return res
      .status(400)
      .json({ ok: false, error: "Invalid appointment ID." });
  }

  const body = req.body || {};
  const appointment_status = requireField(body, "status");

  const validStatuses = ["scheduled", "confirmed", "cancelled", "completed"];
  if (!appointment_status || !validStatuses.includes(appointment_status)) {
    return res
      .status(400)
      .json({ ok: false, error: "Invalid appointment status." });
  }

  const cancel_reason = requireField(body, "cancel_reason") || null;
  if (appointment_status === "cancelled" && !cancel_reason) {
    return res.status(400).json({
      ok: false,
      error: "cancel_reason is required when cancelling.",
    });
  }

  try {
    const [existing] = await pool.execute(
      "SELECT appointment_id FROM appointments WHERE appointment_id = ?",
      [appointmentId],
    );

    if (!existing.length) {
      return res
        .status(404)
        .json({ ok: false, error: "Appointment not found." });
    }

    if (appointment_status === "cancelled") {
      await pool.execute(
        `UPDATE appointments
         SET appointment_status = ?, cancel_reason = ?
         WHERE appointment_id = ?`,
        [appointment_status, cancel_reason, appointmentId],
      );
    } else {
      await pool.execute(
        `UPDATE appointments
         SET appointment_status = ?, cancel_reason = NULL
         WHERE appointment_id = ?`,
        [appointment_status, appointmentId],
      );
    }

    return res.json({ ok: true, message: "Appointment status updated." });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

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
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

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

app.get("/api/patients/search", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  try {
    const q = requireField(req.query, "q");
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
    return res.status(500).json({ error: err?.message || "Database error" });
  }
});

app.get("/api/patients/:id", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  const patientId = parseInt(req.params.id, 10);
  if (!patientId) {
    return res.status(400).json({ ok: false, error: "Invalid patient ID." });
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
      return res.status(404).json({ ok: false, error: "Patient not found." });
    }

    const [[appointmentCountRow]] = await pool.execute(
      "SELECT COUNT(*) AS appointment_count FROM appointments WHERE patient_id = ?",
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
    return res.status(500).json({ error: err?.message || "Database error" });
  }
});

app.get("/api/dentists", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });

  try {
    const [rows] = await pool.execute(
      `SELECT dentist_id, first_name, last_name, specialization
       FROM dentist
       ORDER BY first_name, last_name`,
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err?.message || "Database error" });
  }
});

app.get("/api/dentists/search", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  try {
    const q = requireField(req.query, "q");
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
    return res.status(500).json({ error: err?.message || "Database error" });
  }
});

const TOOTH_STATUSES = ["healthy", "treated", "needs_attention", "extracted"];

app.get("/api/dental-records/patient/:patientId", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  const patientId = parseInt(req.params.patientId, 10);
  if (!patientId) {
    return res.status(400).json({ ok: false, error: "Invalid patient ID." });
  }

  try {
    const [patientRows] = await pool.execute(
      `SELECT
         p.patient_id, p.first_name, p.last_name, p.blood_type, p.date_of_birth,
         COALESCE(pr.patient_status, 'active') AS status
       FROM patients p
       LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
       WHERE p.patient_id = ?`,
      [patientId],
    );

    if (!patientRows.length) {
      return res.status(404).json({ ok: false, error: "Patient not found." });
    }

    const [toothRows] = await pool.execute(
      `SELECT tooth_number, condition_status FROM tooth_chart WHERE patient_id = ?`,
      [patientId],
    );
    const tooth_chart = {};
    toothRows.forEach((row) => {
      tooth_chart[row.tooth_number] = row.condition_status;
    });

    const [vitalsRows] = await pool.execute(
      `SELECT
         DATE_FORMAT(date_recorded, '%Y-%m-%d') AS date_recorded,
         blood_pressure, heart_rate, temperature, weight
       FROM patient_vitals
       WHERE patient_id = ?
       ORDER BY date_recorded DESC, patient_vitals_id DESC`,
      [patientId],
    );

    const [historyRows] = await pool.execute(
      `SELECT allergies, current_medications, medical_conditions, dental_history
       FROM patient_history
       WHERE patient_id = ?`,
      [patientId],
    );

    const [contactRows] = await pool.execute(
      `SELECT emergency_contact_name, emergency_contact_number
       FROM patient_records
       WHERE patient_id = ?`,
      [patientId],
    );

    const patient = patientRows[0];
    const historyRow = historyRows[0] || {};
    const contactRow = contactRows[0] || {};
    const emergencyContact = contactRow.emergency_contact_name
      ? `${contactRow.emergency_contact_name}${contactRow.emergency_contact_number ? " · " + contactRow.emergency_contact_number : ""}`
      : null;

    const [treatmentRows] = await pool.execute(
      `SELECT
         dr.dental_record_id,
         dr.dentist_id,
         DATE_FORMAT(dr.visit_date, '%Y-%m-%d') AS visit_date,
         COALESCE(NULLIF(t.treatment_name, ''), NULLIF(dr.treatment_plan_notes, ''), dr.diagnosis) AS procedure_name,
         dr.teeth_involved,
         COALESCE(NULLIF(t.description, ''), dr.clinical_notes) AS clinical_notes,
         t.default_price AS price,
         t.default_duration AS duration,
         t.category AS category,
         CONCAT(d.first_name, ' ', d.last_name) AS doctor_name
       FROM dental_records dr
       LEFT JOIN dentist d ON d.dentist_id = dr.dentist_id
       LEFT JOIN treatment t ON t.dental_record_id = dr.dental_record_id
       WHERE dr.patient_id = ?
       ORDER BY dr.visit_date DESC, dr.dental_record_id DESC`,
      [patientId],
    );

    return res.json({
      ok: true,
      patient: {
        patient_id: patient.patient_id,
        name: `${patient.first_name} ${patient.last_name}`.trim(),
        blood_type: patient.blood_type,
        date_of_birth: patient.date_of_birth,
        status: patient.status,
      },
      tooth_chart,
      treatments: treatmentRows.map((row) => ({
        treatment_id: row.dental_record_id,
        dentist_id: row.dentist_id,
        date: row.visit_date,
        procedure: row.procedure_name || "—",
        teeth: row.teeth_involved || "—",
        doctor:
          row.doctor_name && row.doctor_name.trim() ? row.doctor_name : "—",
        notes: row.clinical_notes || "—",
        price: row.price !== null && row.price !== undefined ? row.price : null,
        duration:
          row.duration !== null && row.duration !== undefined
            ? row.duration
            : null,
        category: row.category || null,
      })),
      vitals: vitalsRows.map((row) => ({
        date: row.date_recorded,
        bp: row.blood_pressure || "—",
        pulse: row.heart_rate || "—",
        temp: row.temperature || "—",
        weight: row.weight || "—",
      })),
      history: {
        allergies: historyRow.allergies || "None",
        medications: historyRow.current_medications || "None",
        medical: historyRow.medical_conditions || "None",
        dental: historyRow.dental_history || "None",
        blood_type: patient.blood_type || "—",
        emergency_contact: emergencyContact || "—",
      },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.put("/api/dental-records/:id", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  const recordId = parseInt(req.params.id, 10);
  if (!recordId) {
    return res.status(400).json({ ok: false, error: "Invalid record ID." });
  }

  try {
    const body = req.body || {};
    const dentist_id_raw = requireField(body, "dentist_id");
    const dentist_id = dentist_id_raw ? parseInt(dentist_id_raw, 10) : null;
    const visit_date = requireField(body, "visit_date");
    const procedure = requireField(body, "procedure");
    const teeth_involved = requireField(body, "teeth_involved") || null;
    const notes = requireField(body, "notes") || null;
    const price_raw = requireField(body, "price");
    const price = price_raw !== null ? parseFloat(price_raw) : 0;
    const duration_raw = requireField(body, "duration");
    const duration = duration_raw !== null ? parseInt(duration_raw, 10) : null;
    const category = requireField(body, "category") || "dental";

    const missing = [];
    if (!visit_date) missing.push("visit_date");
    if (!procedure) missing.push("procedure");

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(", ")}` });
    }

    const [existing] = await pool.execute(
      "SELECT dental_record_id FROM dental_records WHERE dental_record_id = ?",
      [recordId],
    );

    if (!existing.length) {
      return res
        .status(404)
        .json({ ok: false, error: "Treatment record not found." });
    }

    if (dentist_id) {
      const [dentists] = await pool.execute(
        "SELECT dentist_id FROM dentist WHERE dentist_id = ?",
        [dentist_id],
      );
      if (!dentists.length) {
        return res.status(404).json({ ok: false, error: "Dentist not found." });
      }
    }

    await pool.execute(
      `UPDATE dental_records
       SET dentist_id = ?, visit_date = ?, treatment_plan_notes = ?, teeth_involved = ?, clinical_notes = ?
       WHERE dental_record_id = ?`,
      [dentist_id, visit_date, procedure, teeth_involved, notes, recordId],
    );

    const [existingTreatment] = await pool.execute(
      "SELECT treatment_id FROM treatment WHERE dental_record_id = ?",
      [recordId],
    );

    if (existingTreatment.length) {
      await pool.execute(
        `UPDATE treatment
         SET treatment_name = ?, description = ?, default_duration = ?, default_price = ?, category = ?, teeth_involved = ?
         WHERE dental_record_id = ?`,
        [procedure, notes, duration, price, category, teeth_involved, recordId],
      );
    } else {
      await pool.execute(
        `INSERT INTO treatment
           (dental_record_id, treatment_name, description, default_duration, default_price, category, teeth_involved)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [recordId, procedure, notes, duration, price, category, teeth_involved],
      );
    }

    return res.json({ ok: true, message: "Treatment updated successfully." });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.post("/api/dental-records", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  try {
    const body = req.body || {};
    const patient_id = parseInt(requireField(body, "patient_id"), 10);
    const dentist_id_raw = requireField(body, "dentist_id");
    const dentist_id = dentist_id_raw ? parseInt(dentist_id_raw, 10) : null;
    const visit_date = requireField(body, "visit_date");
    const procedure = requireField(body, "procedure");
    const teeth_involved = requireField(body, "teeth_involved") || null;
    const notes = requireField(body, "notes") || null;
    const price_raw = requireField(body, "price");
    const price = price_raw !== null ? parseFloat(price_raw) : 0;
    const duration_raw = requireField(body, "duration");
    const duration = duration_raw !== null ? parseInt(duration_raw, 10) : null;
    const category = requireField(body, "category") || "dental";

    const missing = [];
    if (!patient_id) missing.push("patient_id");
    if (!visit_date) missing.push("visit_date");
    if (!procedure) missing.push("procedure");

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(", ")}` });
    }

    const [patients] = await pool.execute(
      "SELECT patient_id FROM patients WHERE patient_id = ?",
      [patient_id],
    );
    if (!patients.length) {
      return res.status(404).json({ ok: false, error: "Patient not found." });
    }

    if (dentist_id) {
      const [dentists] = await pool.execute(
        "SELECT dentist_id FROM dentist WHERE dentist_id = ?",
        [dentist_id],
      );
      if (!dentists.length) {
        return res.status(404).json({ ok: false, error: "Dentist not found." });
      }
    }

    const [result] = await pool.execute(
      `INSERT INTO dental_records
         (patient_id, dentist_id, visit_date, treatment_plan_notes, teeth_involved, clinical_notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [patient_id, dentist_id, visit_date, procedure, teeth_involved, notes],
    );

    await pool.execute(
      `INSERT INTO treatment
         (dental_record_id, treatment_name, description, default_duration, default_price, category, teeth_involved)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        result.insertId,
        procedure,
        notes,
        duration,
        price,
        category,
        teeth_involved,
      ],
    );

    let doctorName = "—";
    if (dentist_id) {
      const [dentistRows] = await pool.execute(
        "SELECT first_name, last_name FROM dentist WHERE dentist_id = ?",
        [dentist_id],
      );
      if (dentistRows.length) {
        doctorName =
          `${dentistRows[0].first_name} ${dentistRows[0].last_name}`.trim();
      }
    }

    return res.status(201).json({
      ok: true,
      treatment: {
        treatment_id: result.insertId,
        dentist_id: dentist_id,
        date: visit_date,
        procedure,
        teeth: teeth_involved || "—",
        doctor: doctorName,
        notes: notes || "—",
        price,
        duration,
        category,
      },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.post("/api/patient-vitals", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  try {
    const body = req.body || {};
    const patient_id = parseInt(requireField(body, "patient_id"), 10);
    const date_recorded = requireField(body, "date_recorded");
    const blood_pressure = requireField(body, "blood_pressure") || null;
    const heart_rate = requireField(body, "heart_rate") || null;
    const temperature = requireField(body, "temperature") || null;
    const weight = requireField(body, "weight") || null;

    const missing = [];
    if (!patient_id) missing.push("patient_id");
    if (!date_recorded) missing.push("date_recorded");

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(", ")}` });
    }

    const [patients] = await pool.execute(
      "SELECT patient_id FROM patients WHERE patient_id = ?",
      [patient_id],
    );
    if (!patients.length) {
      return res.status(404).json({ ok: false, error: "Patient not found." });
    }

    await pool.execute(
      `INSERT INTO patient_vitals
         (patient_id, date_recorded, blood_pressure, heart_rate, temperature, weight)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        patient_id,
        date_recorded,
        blood_pressure,
        heart_rate,
        temperature,
        weight,
      ],
    );

    return res.status(201).json({
      ok: true,
      vitals: {
        date: date_recorded,
        bp: blood_pressure || "—",
        pulse: heart_rate || "—",
        temp: temperature || "—",
        weight: weight || "—",
      },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.put("/api/tooth-chart", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  try {
    const body = req.body || {};
    const patient_id = parseInt(requireField(body, "patient_id"), 10);
    const tooth_number = parseInt(requireField(body, "tooth_number"), 10);
    const condition_status = requireField(body, "condition_status");

    const missing = [];
    if (!patient_id) missing.push("patient_id");
    if (!tooth_number) missing.push("tooth_number");
    if (!condition_status) missing.push("condition_status");

    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(", ")}` });
    }

    if (tooth_number < 1 || tooth_number > 32) {
      return res
        .status(400)
        .json({ ok: false, error: "tooth_number must be between 1 and 32." });
    }

    if (!TOOTH_STATUSES.includes(condition_status)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid condition_status." });
    }

    const [patients] = await pool.execute(
      "SELECT patient_id FROM patients WHERE patient_id = ?",
      [patient_id],
    );
    if (!patients.length) {
      return res.status(404).json({ ok: false, error: "Patient not found." });
    }

    await pool.execute(
      `INSERT INTO tooth_chart (patient_id, tooth_number, condition_status)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE condition_status = VALUES(condition_status)`,
      [patient_id, tooth_number, condition_status],
    );

    return res.json({ ok: true, tooth_number, condition_status });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.get("/api/admin/users/summary", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

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
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  try {
    const body = req.body || {};
    const user_id = parseInt(requireField(body, "user_id"), 10);
    const role = requireField(body, "role");
    const hire_date = requireField(body, "hire_date");
    const specialization = requireField(body, "specialization");
    const license_number_raw = requireField(body, "license_number");
    const license_number = license_number_raw
      ? Number(license_number_raw)
      : null;
    const employment_status =
      requireField(body, "employment_status") || "Active";
    const shift_schedule = requireField(body, "shift_schedule");
    const missing = [];
    if (!user_id) missing.push("user_id");
    if (!role) missing.push("role");
    if (!hire_date) missing.push("hire_date");
    if (role === "doctor") {
      if (!specialization) missing.push("specialization");
      if (!license_number_raw || Number.isNaN(license_number))
        missing.push("license_number");
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

    const date_of_birth = requireField(body, "date_of_birth") || "1970-01-01";
    const gender = requireField(body, "gender") || "male";

    if (role === "doctor") {
      const [existing] = await pool.execute(
        "SELECT dentist_id FROM dentist WHERE email = ? OR (first_name = ? AND last_name = ?)",
        [user.email, user.first_name, user.last_name],
      );
      if (existing.length) {
        return res.status(409).json({
          ok: false,
          error: "This user already has a doctor profile.",
        });
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
          user.contact_number || "",
          user.email,
          specialization,
          license_number,
        ],
      );

      await pool.execute("UPDATE users SET role = 'admin' WHERE user_id = ?", [
        user_id,
      ]);
      return res.json({ ok: true, doctor_id: result.insertId, role: "doctor" });
    }

    const [existingStaff] = await pool.execute(
      "SELECT staff_id FROM staff WHERE email = ? OR (first_name = ? AND last_name = ?)",
      [user.email, user.first_name, user.last_name],
    );
    if (existingStaff.length) {
      return res
        .status(409)
        .json({ ok: false, error: "This user already has a staff profile." });
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
        user.contact_number || "",
        user.email,
        shift_schedule,
        hire_date,
        employment_status,
      ],
    );

    await pool.execute("UPDATE users SET role = 'admin' WHERE user_id = ?", [
      user_id,
    ]);
    return res.json({ ok: true, staff_id: result.insertId, role: "staff" });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

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

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
