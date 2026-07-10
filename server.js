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

function requireAdmin(req, res) {
  if (!req.session.userId) {
    res.status(401).json({ ok: false, error: "Not logged in" });
    return false;
  }
  if (req.session.role !== "admin") {
    res.status(403).json({ ok: false, error: "Forbidden" });
    return false;
  }
  return true;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const BILLING_STATUSES = ["unpaid", "partial", "paid"];
const PAYMENT_METHODS = ["cash", "card", "gcash", "bank_transfer", "other"];
const PAYMENT_STATUSES = ["pending", "completed", "failed"];

function amountsEqual(first, second) {
  return Math.abs(Number(first) - Number(second)) < 0.005;
}

async function syncPaidBillingStatuses(billingId = null) {
  const idCondition = billingId ? " AND b.billing_id = ?" : "";
  const params = billingId ? [billingId] : [];
  await pool.execute(
    `UPDATE billing b
     LEFT JOIN (
       SELECT billing_id, SUM(amount_paid) AS amount_paid
       FROM payments
       WHERE payment_status = 'completed'
       GROUP BY billing_id
     ) totals ON totals.billing_id = b.billing_id
     SET b.billing_status = 'paid'
     WHERE b.total_amount - COALESCE(totals.amount_paid, 0) <= 0
       AND b.billing_status <> 'paid'${idCondition}`,
    params,
  );
}

async function createAuditLog(executor, req, details) {
  const [actors] = await executor.execute(
    `SELECT
       u.user_id,
       CONCAT(u.first_name, ' ', u.last_name) AS actor_name,
       CASE
         WHEN d.dentist_id IS NOT NULL THEN 'dentist'
         WHEN s.staff_id IS NOT NULL THEN 'staff'
         ELSE u.role
       END AS actor_type
     FROM users u
     LEFT JOIN dentist d ON d.user_id = u.user_id
     LEFT JOIN staff s ON s.user_id = u.user_id
     WHERE u.user_id = ?`,
    [req.session.userId],
  );
  const actor = actors[0] || {};
  const oldValues =
    details.oldValues === undefined || details.oldValues === null
      ? null
      : JSON.stringify(details.oldValues);
  const newValues =
    details.newValues === undefined || details.newValues === null
      ? null
      : JSON.stringify(details.newValues);
  const ipAddress = String(req.ip || req.socket?.remoteAddress || "")
    .replace(/^::ffff:/, "")
    .slice(0, 45);

  await executor.execute(
    `INSERT INTO audit_logs
       (actor_user_id, actor_name_snapshot, actor_type_snapshot, action,
        entity_type, entity_id, description, old_values, new_values, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.session.userId,
      actor.actor_name || `User #${req.session.userId}`,
      actor.actor_type || req.session.role || "unknown",
      details.action,
      details.entityType,
      details.entityId || null,
      details.description,
      oldValues,
      newValues,
      ipAddress || null,
    ],
  );
}

async function recordAudit(req, details) {
  try {
    await createAuditLog(pool, req, details);
  } catch (error) {
    console.error("Unable to record audit log:", error);
  }
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

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

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
      `SELECT p.*, u.first_name, u.last_name, u.contact_number, u.email
       FROM patients p
       LEFT JOIN users u ON u.user_id = p.user_id
       WHERE p.user_id = ?`,
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

  const conn = await pool.getConnection();
  try {
    const body = req.body || {};

    // first_name, last_name, and contact_number now live on `users`,
    // shared across patients/staff/dentist. Everything else here stays
    // in `patients`.
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
      conn.release();
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(", ")}` });
    }

    const normalizedGender = gender.toLowerCase();
    if (!["male", "female"].includes(normalizedGender)) {
      conn.release();
      return res.status(400).json({ ok: false, error: "Invalid gender." });
    }

    await conn.beginTransaction();

    await conn.execute(
      `UPDATE users SET first_name = ?, last_name = ?, contact_number = ?
       WHERE user_id = ?`,
      [first_name, last_name, contact_number, req.session.userId],
    );

    const [existing] = await conn.execute(
      "SELECT patient_id FROM patients WHERE user_id = ?",
      [req.session.userId],
    );

    let patientId;
    if (existing.length) {
      patientId = existing[0].patient_id;
      await conn.execute(
        `UPDATE patients SET
          date_of_birth = ?, gender = ?, house_no = ?, street = ?,
          barangay = ?, city = ?, zip_code = ?, blood_type = ?
        WHERE user_id = ?`,
        [
          date_of_birth,
          normalizedGender,
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
      const [patientResult] = await conn.execute(
        `INSERT INTO patients
          (user_id, date_of_birth, gender, house_no, street, barangay, city, zip_code, blood_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.session.userId,
          date_of_birth,
          normalizedGender,
          house_no,
          street,
          barangay,
          city,
          zip_code,
          blood_type,
        ],
      );
      patientId = patientResult.insertId;
    }

    await createAuditLog(conn, req, {
      action: "UPDATE_PATIENT",
      entityType: "patient",
      entityId: patientId,
      description: `${existing.length ? "Updated" : "Created"} patient profile #${patientId}`,
      newValues: {
        first_name,
        last_name,
        date_of_birth,
        gender: normalizedGender,
        contact_number,
        city,
        zip_code,
        blood_type,
      },
    });
    await conn.commit();
    return res.json({ ok: true, message: "Profile saved successfully." });
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

app.post("/api/patients", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    const body = req.body || {};

    // first_name/last_name/contact_number now live on `users`. This route
    // links a patient profile to an existing user account instead of
    // collecting name/contact directly.
    const user_id = parseInt(
      requireField(body, "user_id") || requireField(body, "userId"),
      10,
    );
    const date_of_birth =
      requireField(body, "date_of_birth") || requireField(body, "dob");
    const genderRaw = requireField(body, "gender") || requireField(body, "sex");
    const house_no = requireField(body, "house_no");
    const street = requireField(body, "street");
    const barangay = requireField(body, "barangay");
    const city = requireField(body, "city");
    const zip_code =
      requireField(body, "zip_code") || requireField(body, "zip");
    const blood_type = requireField(body, "blood_type");

    const gender = validateGender(genderRaw);

    const missing = [];
    if (!user_id) missing.push("user_id");
    if (!date_of_birth) missing.push("date_of_birth");
    if (!gender) missing.push("gender (male/female)");
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

    const [users] = await pool.execute(
      "SELECT user_id FROM users WHERE user_id = ?",
      [user_id],
    );
    if (!users.length) {
      return res.status(404).json({ ok: false, error: "User not found." });
    }

    const [existing] = await pool.execute(
      "SELECT patient_id FROM patients WHERE user_id = ?",
      [user_id],
    );
    if (existing.length) {
      return res
        .status(409)
        .json({ ok: false, error: "This user already has a patient profile." });
    }

    const [result] = await pool.execute(
      `INSERT INTO patients (
        user_id, date_of_birth, gender, house_no, street, barangay, city, zip_code, blood_type
      ) VALUES (
          :user_id, :date_of_birth, :gender, :house_no, :street, :barangay, :city, :zip_code, :blood_type
      )`,
      {
        user_id,
        date_of_birth,
        gender,
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

    // name/contact_number/email now live on `users`; this route links a
    // staff profile to an existing user account. employment_status column
    // was removed, so it's no longer collected or inserted.
    const user_id = parseInt(
      requireField(body, "user_id") || requireField(body, "userId"),
      10,
    );
    const date_of_birth = requireField(body, "date_of_birth");
    const genderRaw = requireField(body, "gender");
    const shift_schedule = requireField(body, "shift_schedule");
    const hire_date = requireField(body, "hire_date");

    const gender = validateGender(genderRaw);

    const missing = [];
    if (!user_id) missing.push("user_id");
    if (!date_of_birth) missing.push("date_of_birth");
    if (!gender) missing.push("gender (male/female)");
    if (!shift_schedule) missing.push("shift_schedule");
    if (!hire_date) missing.push("hire_date");

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required field(s): ${missing.join(", ")}`,
      });
    }

    const [users] = await pool.execute(
      "SELECT user_id FROM users WHERE user_id = ?",
      [user_id],
    );
    if (!users.length) {
      return res.status(404).json({ ok: false, error: "User not found." });
    }

    const [existing] = await pool.execute(
      "SELECT staff_id FROM staff WHERE user_id = ?",
      [user_id],
    );
    if (existing.length) {
      return res
        .status(409)
        .json({ ok: false, error: "This user already has a staff profile." });
    }

    const [result] = await pool.execute(
      `INSERT INTO staff (
        user_id, date_of_birth, gender, shift_schedule, hire_date
      ) VALUES (
        :user_id, :date_of_birth, :gender, :shift_schedule, :hire_date
      )`,
      {
        user_id,
        date_of_birth,
        gender,
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

    // name/contact_number/email now live on `users`; this route links a
    // dentist profile to an existing user account.
    const user_id = parseInt(
      requireField(body, "user_id") || requireField(body, "userId"),
      10,
    );
    const date_of_birth = requireField(body, "date_of_birth");
    const genderRaw = requireField(body, "gender");
    const hire_date = requireField(body, "hire_date");
    const specialization = requireField(body, "specialization");
    const license_number_raw = requireField(body, "license_number");
    const license_number = license_number_raw
      ? Number(license_number_raw)
      : null;

    const gender = validateGender(genderRaw);

    const missing = [];
    if (!user_id) missing.push("user_id");
    if (!date_of_birth) missing.push("date_of_birth");
    if (!gender) missing.push("gender (male/female)");
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

    const [users] = await conn.execute(
      "SELECT user_id FROM users WHERE user_id = ?",
      [user_id],
    );
    if (!users.length) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "User not found." });
    }

    const [existing] = await conn.execute(
      "SELECT dentist_id FROM dentist WHERE user_id = ?",
      [user_id],
    );
    if (existing.length) {
      await conn.rollback();
      return res
        .status(409)
        .json({ ok: false, error: "This user already has a doctor profile." });
    }

    const [dentistResult] = await conn.execute(
      `INSERT INTO dentist (
        user_id, date_of_birth, gender, specialization, license_number
      ) VALUES (
        :user_id, :date_of_birth, :gender, :specialization, :license_number
      )`,
      {
        user_id,
        date_of_birth,
        gender,
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

    await recordAudit(req, {
      action: "UPDATE_DENTIST_SCHEDULE",
      entityType: "dentist_schedule",
      entityId: result.insertId,
      description: `Added ${day_of_week} schedule for dentist #${dentist_id}`,
      newValues: { dentist_id, day_of_week, start_time, end_time },
    });

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
           pu.first_name, pu.last_name,
           d.dentist_id,
           CONCAT('Dr. ', du.first_name, ' ', du.last_name) AS doctor_name,
           DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
           DATE_FORMAT(a.appointment_time, '%H:%i:%s') AS appointment_time,
           a.appointment_type, a.appointment_status,
           a.reason_for_visit, a.cancel_reason, a.created_at
         FROM appointments a
         JOIN patients p ON p.patient_id = a.patient_id
         JOIN users pu ON pu.user_id = p.user_id
         LEFT JOIN dentist d ON d.dentist_id = a.dentist_id
         LEFT JOIN users du ON du.user_id = d.user_id
         ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
      );
    } else {
      [rows] = await pool.execute(
        `SELECT
           a.appointment_id, a.patient_id,
           pu.first_name, pu.last_name,
           d.dentist_id,
           CONCAT('Dr. ', du.first_name, ' ', du.last_name) AS doctor_name,
           DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
           DATE_FORMAT(a.appointment_time, '%H:%i:%s') AS appointment_time,
           a.appointment_type, a.appointment_status,
           a.reason_for_visit, a.cancel_reason, a.created_at
         FROM appointments a
         JOIN patients p ON p.patient_id = a.patient_id
         JOIN users pu ON pu.user_id = p.user_id
         LEFT JOIN dentist d ON d.dentist_id = a.dentist_id
         LEFT JOIN users du ON du.user_id = d.user_id
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

    const validStatuses = ["scheduled", "completed", "cancelled"];
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

    await recordAudit(req, {
      action: "CREATE_APPOINTMENT",
      entityType: "appointment",
      entityId: result.insertId,
      description: `Created appointment #${result.insertId} for patient #${patient_id}`,
      newValues: {
        patient_id,
        dentist_id,
        appointment_date,
        appointment_time,
        appointment_type,
        appointment_status,
      },
    });

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

    await recordAudit(req, {
      action: "CANCEL_APPOINTMENT",
      entityType: "appointment",
      entityId: appointmentId,
      description: `Cancelled appointment #${appointmentId}`,
      oldValues: { appointment_status: existing[0].appointment_status },
      newValues: { appointment_status: "cancelled", cancel_reason },
    });

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

  const validStatuses = ["scheduled", "cancelled", "completed"];
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
      "SELECT appointment_id, appointment_status FROM appointments WHERE appointment_id = ?",
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

    await recordAudit(req, {
      action: "UPDATE_APPOINTMENT_STATUS",
      entityType: "appointment",
      entityId: appointmentId,
      description: `Changed appointment #${appointmentId} status to ${appointment_status}`,
      oldValues: { appointment_status: existing[0].appointment_status },
      newValues: { appointment_status, cancel_reason },
    });

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
       WHERE appointment_status = 'scheduled'`,
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
         CONCAT(u.first_name, ' ', u.last_name)                               AS patient,
         CONCAT('Dr. ', du.first_name, ' ', du.last_name)                     AS doctor_name,
         COALESCE(NULLIF(a.reason_for_visit, ''), a.appointment_type)         AS reason,
         a.appointment_status                                                  AS status,
         a.appointment_id
       FROM appointments a
       JOIN patients p ON p.patient_id = a.patient_id
       JOIN users u ON u.user_id = p.user_id
       LEFT JOIN dentist d ON d.dentist_id = a.dentist_id
       LEFT JOIN users du ON du.user_id = d.user_id
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

app.get("/api/audit-logs", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const search = requireField(req.query, "search") || "";
  const action = requireField(req.query, "action") || "";
  const entityType = requireField(req.query, "entity_type") || "";
  const dateFrom = requireField(req.query, "date_from") || "";
  const dateTo = requireField(req.query, "date_to") || "";
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(
    100,
    Math.max(10, Number.parseInt(req.query.limit, 10) || 25),
  );

  if ((dateFrom && !isIsoDate(dateFrom)) || (dateTo && !isIsoDate(dateTo))) {
    return res
      .status(400)
      .json({ ok: false, error: "Invalid audit date filter." });
  }

  const where = [];
  const params = [];
  if (search) {
    const term = `%${search}%`;
    where.push(
      "(actor_name_snapshot LIKE ? OR description LIKE ? OR CAST(entity_id AS CHAR) LIKE ?)",
    );
    params.push(term, term, term);
  }
  if (action) {
    where.push("action = ?");
    params.push(action);
  }
  if (entityType) {
    where.push("entity_type = ?");
    params.push(entityType);
  }
  if (dateFrom) {
    where.push("created_at >= ?");
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    where.push("created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(`${dateTo} 00:00:00`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (page - 1) * limit;

  try {
    const [[countRow]] = await pool.execute(
      `SELECT COUNT(*) AS total FROM audit_logs ${whereSql}`,
      params,
    );
    const [rows] = await pool.execute(
      `SELECT audit_log_id, actor_user_id, actor_name_snapshot,
              actor_type_snapshot, action, entity_type, entity_id,
              description, ip_address,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM audit_logs
       ${whereSql}
       ORDER BY created_at DESC, audit_log_id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return res.json({
      ok: true,
      logs: rows,
      pagination: {
        page,
        limit,
        total: Number(countRow.total),
        pages: Math.max(1, Math.ceil(Number(countRow.total) / limit)),
      },
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.get("/api/audit-logs/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const auditLogId = Number.parseInt(req.params.id, 10);
  if (!auditLogId) {
    return res.status(400).json({ ok: false, error: "Invalid audit log ID." });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT audit_log_id, actor_user_id, actor_name_snapshot,
              actor_type_snapshot, action, entity_type, entity_id,
              description, old_values, new_values, ip_address,
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
       FROM audit_logs
       WHERE audit_log_id = ?`,
      [auditLogId],
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "Audit log not found." });
    }
    return res.json({ ok: true, log: rows[0] });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.get("/api/billings", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const q = requireField(req.query, "q") || "";
  const status = (requireField(req.query, "status") || "").toLowerCase();
  if (status && !BILLING_STATUSES.includes(status)) {
    return res
      .status(400)
      .json({ ok: false, error: "Invalid billing status." });
  }

  try {
    await syncPaidBillingStatuses();
    const search = `%${q}%`;
    const [rows] = await pool.execute(
      `SELECT
         b.billing_id,
         b.patient_id,
         CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
         DATE_FORMAT(b.billing_date, '%Y-%m-%d') AS billing_date,
         t.treatment_name,
         b.total_amount,
         COALESCE(SUM(CASE WHEN pay.payment_status = 'completed' THEN pay.amount_paid ELSE 0 END), 0) AS amount_paid,
         b.total_amount - COALESCE(SUM(CASE WHEN pay.payment_status = 'completed' THEN pay.amount_paid ELSE 0 END), 0) AS balance,
         b.billing_status
       FROM billing b
       JOIN patient_treatments pt ON pt.patient_treatment_id = b.patient_treatment_id
       JOIN patients p ON p.patient_id = b.patient_id
       JOIN users u ON u.user_id = p.user_id
       JOIN treatment t ON t.treatment_id = pt.treatment_id
       LEFT JOIN payments pay ON pay.billing_id = b.billing_id
       WHERE (? = '' OR CONCAT(u.first_name, ' ', u.last_name) LIKE ? OR CAST(b.billing_id AS CHAR) LIKE ?)
         AND (? = '' OR b.billing_status = ?)
       GROUP BY b.billing_id, b.patient_id, u.first_name, u.last_name,
                b.billing_date, t.treatment_name, b.total_amount, b.billing_status
       ORDER BY b.billing_date DESC, b.billing_id DESC`,
      [q, search, search, status, status],
    );

    return res.json({ ok: true, billings: rows });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.get("/api/billing/patients/:patientId/treatments", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const patientId = parseInt(req.params.patientId, 10);
  if (!patientId) {
    return res.status(400).json({ ok: false, error: "Invalid patient ID." });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
         pt.patient_treatment_id,
         t.treatment_name,
         pt.actual_price,
         DATE_FORMAT(dr.visit_date, '%Y-%m-%d') AS treatment_date
       FROM patient_treatments pt
       JOIN dental_records dr ON dr.dental_record_id = pt.dental_record_id
       JOIN treatment t ON t.treatment_id = pt.treatment_id
       LEFT JOIN billing b ON b.patient_treatment_id = pt.patient_treatment_id
       WHERE dr.patient_id = ? AND b.billing_id IS NULL
       ORDER BY dr.visit_date DESC, pt.patient_treatment_id DESC`,
      [patientId],
    );

    return res.json({ ok: true, treatments: rows });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.post("/api/billings", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const patientTreatmentId = Number.parseInt(
    req.body?.patient_treatment_id,
    10,
  );
  const billingDate = requireField(req.body, "billing_date");
  const totalAmountValue = requireField(req.body, "total_amount");
  const totalAmount = Number(totalAmountValue);
  const billingStatus = (
    requireField(req.body, "billing_status") || ""
  ).toLowerCase();

  if (!patientTreatmentId) {
    return res
      .status(400)
      .json({ ok: false, error: "Please select a treatment." });
  }
  if (!isIsoDate(billingDate)) {
    return res
      .status(400)
      .json({ ok: false, error: "A valid billing date is required." });
  }
  if (
    totalAmountValue === null ||
    totalAmountValue === "" ||
    !Number.isFinite(totalAmount) ||
    totalAmount < 0
  ) {
    return res
      .status(400)
      .json({ ok: false, error: "Total amount must be zero or greater." });
  }
  if (!BILLING_STATUSES.includes(billingStatus)) {
    return res
      .status(400)
      .json({ ok: false, error: "Please select a valid billing status." });
  }

  try {
    const [treatmentRows] = await pool.execute(
      `SELECT pt.patient_treatment_id, dr.patient_id
       FROM patient_treatments pt
       JOIN dental_records dr ON dr.dental_record_id = pt.dental_record_id
       WHERE pt.patient_treatment_id = ?`,
      [patientTreatmentId],
    );
    if (!treatmentRows.length) {
      return res.status(404).json({ ok: false, error: "Treatment not found." });
    }

    const effectiveBillingStatus = amountsEqual(totalAmount, 0)
      ? "paid"
      : billingStatus;
    const [result] = await pool.execute(
      `INSERT INTO billing
         (patient_id, patient_treatment_id, billing_date, total_amount, billing_status)
       VALUES (?, ?, ?, ?, ?)`,
      [
        treatmentRows[0].patient_id,
        patientTreatmentId,
        billingDate,
        totalAmount,
        effectiveBillingStatus,
      ],
    );

    await recordAudit(req, {
      action: "CREATE_BILLING",
      entityType: "billing",
      entityId: result.insertId,
      description: `Created billing statement #${result.insertId}`,
      newValues: {
        patient_id: treatmentRows[0].patient_id,
        patient_treatment_id: patientTreatmentId,
        billing_date: billingDate,
        total_amount: totalAmount,
        billing_status: effectiveBillingStatus,
      },
    });

    return res.status(201).json({
      ok: true,
      message: "Billing statement created.",
      billing_id: result.insertId,
    });
  } catch (err) {
    if (err?.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        ok: false,
        error: "This treatment already has a billing statement.",
      });
    }
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.get("/api/billings/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const billingId = Number.parseInt(req.params.id, 10);
  if (!billingId) {
    return res.status(400).json({ ok: false, error: "Invalid billing ID." });
  }

  try {
    await syncPaidBillingStatuses(billingId);
    const [billingRows] = await pool.execute(
      `SELECT
         b.billing_id,
         b.patient_treatment_id,
         b.patient_id,
         CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
         DATE_FORMAT(b.billing_date, '%Y-%m-%d') AS billing_date,
         t.treatment_name,
         b.total_amount,
         COALESCE(SUM(CASE WHEN pay.payment_status = 'completed' THEN pay.amount_paid ELSE 0 END), 0) AS amount_paid,
         b.total_amount - COALESCE(SUM(CASE WHEN pay.payment_status = 'completed' THEN pay.amount_paid ELSE 0 END), 0) AS balance,
         b.billing_status
       FROM billing b
       JOIN patient_treatments pt ON pt.patient_treatment_id = b.patient_treatment_id
       JOIN patients p ON p.patient_id = b.patient_id
       JOIN users u ON u.user_id = p.user_id
       JOIN treatment t ON t.treatment_id = pt.treatment_id
       LEFT JOIN payments pay ON pay.billing_id = b.billing_id
       WHERE b.billing_id = ?
       GROUP BY b.billing_id, b.patient_treatment_id, b.patient_id,
                u.first_name, u.last_name, b.billing_date, t.treatment_name,
                b.total_amount, b.billing_status`,
      [billingId],
    );

    if (!billingRows.length) {
      return res
        .status(404)
        .json({ ok: false, error: "Billing statement not found." });
    }

    const [paymentRows] = await pool.execute(
      `SELECT
         pay.payment_id,
         DATE_FORMAT(pay.payment_date, '%Y-%m-%d') AS payment_date,
         pay.amount_paid,
         pay.payment_method,
         pay.payment_status,
         COALESCE(
           pay.reference_number,
           CONCAT(
             'PAY-',
             DATE_FORMAT(pay.payment_date, '%Y%m%d'),
             '-',
             LPAD(pay.payment_id, 6, '0')
           )
         ) AS reference_number,
         pay.external_reference,
         pay.notes,
         COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'Unknown') AS recorded_by_name
       FROM payments pay
       LEFT JOIN users u ON u.user_id = pay.recorded_by
       WHERE pay.billing_id = ?
       ORDER BY pay.payment_date DESC, pay.payment_id DESC`,
      [billingId],
    );

    return res.json({
      ok: true,
      billing: billingRows[0],
      payments: paymentRows,
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

app.patch("/api/billings/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const billingId = Number.parseInt(req.params.id, 10);
  const billingDate = requireField(req.body, "billing_date");
  const totalAmountValue = requireField(req.body, "total_amount");
  const totalAmount = Number(totalAmountValue);
  const billingStatus = (
    requireField(req.body, "billing_status") || ""
  ).toLowerCase();

  if (!billingId) {
    return res.status(400).json({ ok: false, error: "Invalid billing ID." });
  }
  if (!isIsoDate(billingDate)) {
    return res
      .status(400)
      .json({ ok: false, error: "A valid billing date is required." });
  }
  if (
    totalAmountValue === null ||
    totalAmountValue === "" ||
    !Number.isFinite(totalAmount) ||
    totalAmount < 0
  ) {
    return res
      .status(400)
      .json({ ok: false, error: "Total amount must be zero or greater." });
  }
  if (!BILLING_STATUSES.includes(billingStatus)) {
    return res
      .status(400)
      .json({ ok: false, error: "Please select a valid billing status." });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [billingRows] = await conn.execute(
      `SELECT billing_id, DATE_FORMAT(billing_date, '%Y-%m-%d') AS billing_date,
              total_amount, billing_status
       FROM billing WHERE billing_id = ? FOR UPDATE`,
      [billingId],
    );
    if (!billingRows.length) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, error: "Billing statement not found." });
    }

    const [[paymentTotal]] = await conn.execute(
      `SELECT COALESCE(SUM(amount_paid), 0) AS amount_paid
       FROM payments
       WHERE billing_id = ? AND payment_status = 'completed'`,
      [billingId],
    );
    if (Number(paymentTotal.amount_paid) > totalAmount) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Total amount cannot be less than the completed payments.",
      });
    }

    const effectiveBillingStatus = amountsEqual(
      paymentTotal.amount_paid,
      totalAmount,
    )
      ? "paid"
      : billingStatus;
    await conn.execute(
      `UPDATE billing
       SET billing_date = ?, total_amount = ?, billing_status = ?
       WHERE billing_id = ?`,
      [billingDate, totalAmount, effectiveBillingStatus, billingId],
    );
    await createAuditLog(conn, req, {
      action: "UPDATE_BILLING",
      entityType: "billing",
      entityId: billingId,
      description: `Updated billing statement #${billingId}`,
      oldValues: {
        billing_date: billingRows[0].billing_date,
        total_amount: billingRows[0].total_amount,
        billing_status: billingRows[0].billing_status,
      },
      newValues: {
        billing_date: billingDate,
        total_amount: totalAmount,
        billing_status: effectiveBillingStatus,
      },
    });
    await conn.commit();
    return res.json({
      ok: true,
      message: "Billing statement updated.",
      billing_status: effectiveBillingStatus,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  } finally {
    if (conn) conn.release();
  }
});

app.post("/api/billings/:id/payments", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  const billingId = Number.parseInt(req.params.id, 10);
  const paymentDate = requireField(req.body, "payment_date");
  const amountPaid = Number(requireField(req.body, "amount_paid"));
  const paymentMethod = (
    requireField(req.body, "payment_method") || ""
  ).toLowerCase();
  const paymentStatus = (
    requireField(req.body, "payment_status") || ""
  ).toLowerCase();
  const billingStatus = (
    requireField(req.body, "billing_status") || ""
  ).toLowerCase();
  const externalReference = requireField(req.body, "external_reference");
  const notes = requireField(req.body, "notes");

  if (!billingId) {
    return res.status(400).json({ ok: false, error: "Invalid billing ID." });
  }
  if (!isIsoDate(paymentDate)) {
    return res
      .status(400)
      .json({ ok: false, error: "A valid payment date is required." });
  }
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
    return res
      .status(400)
      .json({ ok: false, error: "Payment amount must be greater than zero." });
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res
      .status(400)
      .json({ ok: false, error: "Please select a valid payment method." });
  }
  if (!PAYMENT_STATUSES.includes(paymentStatus)) {
    return res
      .status(400)
      .json({ ok: false, error: "Please select a valid payment status." });
  }
  if (!BILLING_STATUSES.includes(billingStatus)) {
    return res
      .status(400)
      .json({ ok: false, error: "Please select the billing status manually." });
  }
  if (externalReference && externalReference.length > 100) {
    return res
      .status(400)
      .json({ ok: false, error: "External reference is too long." });
  }
  if (notes && notes.length > 255) {
    return res
      .status(400)
      .json({ ok: false, error: "Payment notes are too long." });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    const [billingRows] = await conn.execute(
      "SELECT total_amount FROM billing WHERE billing_id = ? FOR UPDATE",
      [billingId],
    );
    if (!billingRows.length) {
      await conn.rollback();
      return res
        .status(404)
        .json({ ok: false, error: "Billing statement not found." });
    }

    const [[paymentTotal]] = await conn.execute(
      `SELECT COALESCE(SUM(amount_paid), 0) AS amount_paid
       FROM payments
       WHERE billing_id = ? AND payment_status = 'completed'`,
      [billingId],
    );
    const newPaidTotal =
      Number(paymentTotal.amount_paid) +
      (paymentStatus === "completed" ? amountPaid : 0);
    if (newPaidTotal - Number(billingRows[0].total_amount) > 0.005) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: "Completed payment cannot exceed the remaining balance.",
      });
    }
    const effectiveBillingStatus = amountsEqual(
      newPaidTotal,
      billingRows[0].total_amount,
    )
      ? "paid"
      : billingStatus;

    const [result] = await conn.execute(
      `INSERT INTO payments
         (billing_id, payment_date, amount_paid, payment_method, payment_status,
          external_reference, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        billingId,
        paymentDate,
        amountPaid,
        paymentMethod,
        paymentStatus,
        externalReference,
        notes,
        req.session.userId,
      ],
    );
    const referenceNumber = `PAY-${paymentDate.replace(/-/g, "")}-${String(
      result.insertId,
    ).padStart(6, "0")}`;
    await conn.execute(
      "UPDATE payments SET reference_number = ? WHERE payment_id = ?",
      [referenceNumber, result.insertId],
    );
    await conn.execute(
      "UPDATE billing SET billing_status = ? WHERE billing_id = ?",
      [effectiveBillingStatus, billingId],
    );
    await createAuditLog(conn, req, {
      action: "RECORD_PAYMENT",
      entityType: "payment",
      entityId: result.insertId,
      description: `Recorded payment ${referenceNumber} for billing #${billingId}`,
      newValues: {
        billing_id: billingId,
        payment_date: paymentDate,
        amount_paid: amountPaid,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        billing_status: effectiveBillingStatus,
        reference_number: referenceNumber,
        external_reference: externalReference,
      },
    });
    await conn.commit();

    return res.status(201).json({
      ok: true,
      message: "Payment recorded.",
      payment_id: result.insertId,
      reference_number: referenceNumber,
      billing_status: effectiveBillingStatus,
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  } finally {
    if (conn) conn.release();
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
         u.first_name,
         u.last_name,
         u.contact_number,
         u.email
       FROM patients p
       LEFT JOIN users u ON u.user_id = p.user_id
       WHERE u.first_name LIKE ?
          OR u.last_name LIKE ?
          OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?
          OR u.email LIKE ?
          OR u.contact_number LIKE ?
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
         p.patient_id, p.user_id, u.first_name, u.last_name,
         p.date_of_birth, p.gender, u.contact_number,
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
      `SELECT d.dentist_id, u.first_name, u.last_name, d.specialization
       FROM dentist d
       JOIN users u ON u.user_id = d.user_id
       ORDER BY u.first_name, u.last_name`,
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
      `SELECT d.dentist_id, u.first_name, u.last_name, d.specialization, u.email
         FROM dentist d
         JOIN users u ON u.user_id = d.user_id
        WHERE u.first_name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.first_name, ' ', u.last_name) LIKE ? OR u.email LIKE ? OR d.specialization LIKE ?
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

app.get("/api/appointments/patient/:patientId", async (req, res) => {
  if (!req.session.userId)
    return res.status(401).json({ error: "Not logged in" });
  if (req.session.role !== "admin")
    return res.status(403).json({ error: "Forbidden" });

  const patientId = parseInt(req.params.patientId, 10);
  if (!patientId) {
    return res.status(400).json({ ok: false, error: "Invalid patient ID." });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
         a.appointment_id, a.dentist_id,
         CONCAT('Dr. ', du.first_name, ' ', du.last_name) AS doctor_name,
         DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
         DATE_FORMAT(a.appointment_time, '%H:%i:%s') AS appointment_time,
         a.appointment_type, a.appointment_status,
         (dr.dental_record_id IS NOT NULL) AS has_dental_record
       FROM appointments a
       LEFT JOIN dentist d ON d.dentist_id = a.dentist_id
       LEFT JOIN users du ON du.user_id = d.user_id
       LEFT JOIN dental_records dr ON dr.appointment_id = a.appointment_id
       WHERE a.patient_id = ?
       ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
      [patientId],
    );

    return res.json({ ok: true, appointments: rows });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ ok: false, error: err?.message || "Database error" });
  }
});

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
         p.patient_id, u.first_name, u.last_name, p.blood_type, p.date_of_birth,
         COALESCE(pr.patient_status, 'active') AS status
       FROM patients p
       LEFT JOIN users u ON u.user_id = p.user_id
       LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
       WHERE p.patient_id = ?`,
      [patientId],
    );

    if (!patientRows.length) {
      return res.status(404).json({ ok: false, error: "Patient not found." });
    }

    const [toothRows] = await pool.execute(
      `SELECT tc.tooth_number, tc.condition_status
       FROM tooth_chart tc
       JOIN dental_records dr ON dr.dental_record_id = tc.dental_record_id
       WHERE dr.patient_id = ?
       ORDER BY tc.recorded_at DESC`,
      [patientId],
    );
    const tooth_chart = {};
    toothRows.forEach((row) => {
      tooth_chart[row.tooth_number] = row.condition_status;
    });

    const [vitalsRows] = await pool.execute(
      `SELECT
         DATE_FORMAT(pv.date_recorded, '%Y-%m-%d') AS date_recorded,
         pv.blood_pressure, pv.heart_rate, pv.temperature, pv.weight
       FROM patient_vitals pv
       JOIN dental_records dr ON dr.dental_record_id = pv.dental_record_id
       WHERE dr.patient_id = ?
       ORDER BY pv.date_recorded DESC, pv.patient_vitals_id DESC`,
      [patientId],
    );

    const patient = patientRows[0];

    const [treatmentRows] = await pool.execute(
      `SELECT
         dr.dental_record_id,
         dr.dentist_id,
         dr.appointment_id,
         DATE_FORMAT(dr.visit_date, '%Y-%m-%d') AS visit_date,
         COALESCE(NULLIF(t.treatment_name, ''), NULLIF(dr.treatment_plan_notes, '')) AS procedure_name,
         COALESCE(NULLIF(pt.teeth_involved, ''), dr.teeth_involved) AS teeth_involved,
         t.description AS treatment_notes,
         COALESCE(pt.actual_price, t.default_price) AS price,
         COALESCE(pt.actual_duration, t.default_duration) AS duration,
         t.category AS category,
         CONCAT(du.first_name, ' ', du.last_name) AS doctor_name
       FROM dental_records dr
       LEFT JOIN dentist d ON d.dentist_id = dr.dentist_id
       LEFT JOIN users du ON du.user_id = d.user_id
       LEFT JOIN patient_treatments pt ON pt.dental_record_id = dr.dental_record_id
       LEFT JOIN treatment t ON t.treatment_id = pt.treatment_id
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
        appointment_id: row.appointment_id,
        date: row.visit_date,
        procedure: row.procedure_name || "—",
        teeth: row.teeth_involved || "—",
        doctor:
          row.doctor_name && row.doctor_name.trim() ? row.doctor_name : "—",
        notes: row.treatment_notes || "—",
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
      `SELECT dr.dental_record_id, dr.dentist_id,
              DATE_FORMAT(dr.visit_date, '%Y-%m-%d') AS visit_date,
              t.treatment_name AS procedure_name,
              pt.actual_price AS price,
              t.category
       FROM dental_records dr
       LEFT JOIN patient_treatments pt ON pt.dental_record_id = dr.dental_record_id
       LEFT JOIN treatment t ON t.treatment_id = pt.treatment_id
       WHERE dr.dental_record_id = ?`,
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
       SET dentist_id = ?, visit_date = ?, treatment_plan_notes = ?, teeth_involved = ?
       WHERE dental_record_id = ?`,
      [dentist_id, visit_date, procedure, teeth_involved, recordId],
    );

    const [existingLink] = await pool.execute(
      "SELECT patient_treatment_id, treatment_id FROM patient_treatments WHERE dental_record_id = ?",
      [recordId],
    );

    if (existingLink.length) {
      const treatmentId = existingLink[0].treatment_id;
      await pool.execute(
        `UPDATE treatment
         SET treatment_name = ?, description = ?, default_duration = ?, default_price = ?, category = ?
         WHERE treatment_id = ?`,
        [procedure, notes, duration, price, category, treatmentId],
      );
      await pool.execute(
        `UPDATE patient_treatments
         SET teeth_involved = ?, actual_price = ?, actual_duration = ?
         WHERE patient_treatment_id = ?`,
        [teeth_involved, price, duration, existingLink[0].patient_treatment_id],
      );
    } else {
      const [newTreatment] = await pool.execute(
        `INSERT INTO treatment (treatment_name, description, default_duration, default_price, category)
         VALUES (?, ?, ?, ?, ?)`,
        [procedure, notes, duration, price, category],
      );
      await pool.execute(
        `INSERT INTO patient_treatments
           (dental_record_id, treatment_id, teeth_involved, actual_price, actual_duration)
         VALUES (?, ?, ?, ?, ?)`,
        [recordId, newTreatment.insertId, teeth_involved, price, duration],
      );
    }

    await recordAudit(req, {
      action: "UPDATE_DENTAL_RECORD",
      entityType: "dental_record",
      entityId: recordId,
      description: `Updated dental record #${recordId}`,
      oldValues: {
        dentist_id: existing[0].dentist_id,
        visit_date: existing[0].visit_date,
        procedure: existing[0].procedure_name,
        price: existing[0].price,
        category: existing[0].category,
      },
      newValues: {
        dentist_id,
        visit_date,
        procedure,
        teeth_involved,
        price,
        duration,
        category,
      },
    });

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
    const appointment_id_raw = requireField(body, "appointment_id");
    const appointment_id = appointment_id_raw
      ? parseInt(appointment_id_raw, 10)
      : null;
    const dentist_id_raw = requireField(body, "dentist_id");
    let dentist_id = dentist_id_raw ? parseInt(dentist_id_raw, 10) : null;
    let visit_date = requireField(body, "visit_date");
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

    // If linking to an appointment, confirm it belongs to this patient and
    // borrow its date/dentist for anything the admin didn't fill in.
    if (appointment_id) {
      const [appointmentRows] = await pool.execute(
        `SELECT appointment_id, patient_id, dentist_id,
                DATE_FORMAT(appointment_date, '%Y-%m-%d') AS appointment_date
         FROM appointments WHERE appointment_id = ?`,
        [appointment_id],
      );
      if (!appointmentRows.length) {
        return res
          .status(404)
          .json({ ok: false, error: "Appointment not found." });
      }
      if (appointmentRows[0].patient_id !== patient_id) {
        return res.status(400).json({
          ok: false,
          error: "That appointment does not belong to this patient.",
        });
      }
      if (!dentist_id) dentist_id = appointmentRows[0].dentist_id;
      if (!visit_date) visit_date = appointmentRows[0].appointment_date;
    }

    if (!visit_date) missing.push("visit_date");
    if (missing.length) {
      return res
        .status(400)
        .json({ ok: false, error: `Missing field(s): ${missing.join(", ")}` });
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

    // dental_records.recorded_by references users(user_id) — any logged-in
    // admin (staff, dentist, or plain admin) can record entries.
    const recorded_by = req.session.userId;

    const [result] = await pool.execute(
      `INSERT INTO dental_records
         (patient_id, appointment_id, dentist_id, recorded_by, visit_date, treatment_plan_notes, teeth_involved)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        patient_id,
        appointment_id,
        dentist_id,
        recorded_by,
        visit_date,
        procedure,
        teeth_involved,
      ],
    );

    if (appointment_id) {
      await pool.execute(
        `UPDATE appointments SET appointment_status = 'completed'
         WHERE appointment_id = ? AND appointment_status = 'scheduled'`,
        [appointment_id],
      );
    }

    const [newTreatment] = await pool.execute(
      `INSERT INTO treatment (treatment_name, description, default_duration, default_price, category)
       VALUES (?, ?, ?, ?, ?)`,
      [procedure, notes, duration, price, category],
    );

    await pool.execute(
      `INSERT INTO patient_treatments
         (dental_record_id, treatment_id, teeth_involved, actual_price, actual_duration)
       VALUES (?, ?, ?, ?, ?)`,
      [result.insertId, newTreatment.insertId, teeth_involved, price, duration],
    );

    await recordAudit(req, {
      action: "CREATE_DENTAL_RECORD",
      entityType: "dental_record",
      entityId: result.insertId,
      description: `Created dental record #${result.insertId} for patient #${patient_id}`,
      newValues: {
        patient_id,
        appointment_id,
        dentist_id,
        visit_date,
        procedure,
        teeth_involved,
        price,
        duration,
        category,
      },
    });

    let doctorName = "—";
    if (dentist_id) {
      const [dentistRows] = await pool.execute(
        `SELECT u.first_name, u.last_name FROM dentist d
         JOIN users u ON u.user_id = d.user_id
         WHERE d.dentist_id = ?`,
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
    const dental_record_id_raw = requireField(body, "dental_record_id");
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

    // patient_vitals.staff_id references users(user_id) — any logged-in
    // admin (staff, dentist, or plain admin) can record vitals.
    const staff_id = req.session.userId;

    let dental_record_id = dental_record_id_raw
      ? parseInt(dental_record_id_raw, 10)
      : null;

    if (!dental_record_id) {
      const [latestRecord] = await pool.execute(
        `SELECT dental_record_id FROM dental_records
         WHERE patient_id = ?
         ORDER BY visit_date DESC, dental_record_id DESC
         LIMIT 1`,
        [patient_id],
      );
      if (latestRecord.length) {
        dental_record_id = latestRecord[0].dental_record_id;
      } else {
        const [newRecord] = await pool.execute(
          `INSERT INTO dental_records (patient_id, recorded_by, visit_date)
           VALUES (?, ?, CURDATE())`,
          [patient_id, req.session.userId],
        );
        dental_record_id = newRecord.insertId;
      }
    }

    await pool.execute(
      `INSERT INTO patient_vitals
         (dental_record_id, staff_id, date_recorded, blood_pressure, heart_rate, temperature, weight)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        dental_record_id,
        staff_id,
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

    // tooth_chart hangs off a dental_record rather than the patient
    // directly. Use the patient's most recent dental record, or create a
    // bare one now if the patient doesn't have one yet.
    let dental_record_id;
    const [latestRecord] = await pool.execute(
      `SELECT dental_record_id FROM dental_records
       WHERE patient_id = ?
       ORDER BY visit_date DESC, dental_record_id DESC
       LIMIT 1`,
      [patient_id],
    );
    if (latestRecord.length) {
      dental_record_id = latestRecord[0].dental_record_id;
    } else {
      const [newRecord] = await pool.execute(
        `INSERT INTO dental_records (patient_id, recorded_by, visit_date)
         VALUES (?, ?, CURDATE())`,
        [patient_id, req.session.userId],
      );
      dental_record_id = newRecord.insertId;
    }

    const [existingEntry] = await pool.execute(
      `SELECT tooth_chart_id FROM tooth_chart
       WHERE dental_record_id = ? AND tooth_number = ?`,
      [dental_record_id, tooth_number],
    );

    if (existingEntry.length) {
      await pool.execute(
        `UPDATE tooth_chart SET condition_status = ? WHERE tooth_chart_id = ?`,
        [condition_status, existingEntry[0].tooth_chart_id],
      );
    } else {
      await pool.execute(
        `INSERT INTO tooth_chart (dental_record_id, tooth_number, condition_status)
         VALUES (?, ?, ?)`,
        [dental_record_id, tooth_number, condition_status],
      );
    }

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
      `SELECT d.dentist_id, u.first_name, u.last_name, d.specialization
         FROM dentist d
         JOIN users u ON u.user_id = d.user_id
        ORDER BY u.created_at DESC
        LIMIT 5`,
    );
    const [staff] = await pool.execute(
      `SELECT s.staff_id, u.first_name, u.last_name, s.shift_schedule
         FROM staff s
         JOIN users u ON u.user_id = s.user_id
        ORDER BY u.created_at DESC
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
    // employment_status column was removed from staff; no longer collected.
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

    const date_of_birth = requireField(body, "date_of_birth") || "1970-01-01";
    const gender = requireField(body, "gender") || "male";

    if (role === "doctor") {
      // name/contact/email now come from the linked users row, so dedupe
      // by user_id rather than by name or email.
      const [existing] = await pool.execute(
        "SELECT dentist_id FROM dentist WHERE user_id = ?",
        [user_id],
      );
      if (existing.length) {
        return res.status(409).json({
          ok: false,
          error: "This user already has a doctor profile.",
        });
      }

      const [result] = await pool.execute(
        `INSERT INTO dentist (
           user_id, date_of_birth, gender, specialization, license_number
         ) VALUES (?, ?, ?, ?, ?)`,
        [user_id, date_of_birth, gender, specialization, license_number],
      );

      await pool.execute("UPDATE users SET role = 'admin' WHERE user_id = ?", [
        user_id,
      ]);
      await recordAudit(req, {
        action: "PROMOTE_USER",
        entityType: "user",
        entityId: user_id,
        description: `Promoted ${users[0].first_name} ${users[0].last_name} to dentist`,
        oldValues: { role: users[0].role },
        newValues: {
          role: "admin",
          profile_type: "dentist",
          dentist_id: result.insertId,
          specialization,
        },
      });
      return res.json({ ok: true, doctor_id: result.insertId, role: "doctor" });
    }

    const [existingStaff] = await pool.execute(
      "SELECT staff_id FROM staff WHERE user_id = ?",
      [user_id],
    );
    if (existingStaff.length) {
      return res
        .status(409)
        .json({ ok: false, error: "This user already has a staff profile." });
    }

    const [result] = await pool.execute(
      `INSERT INTO staff (
         user_id, date_of_birth, gender, shift_schedule, hire_date
       ) VALUES (?, ?, ?, ?, ?)`,
      [user_id, date_of_birth, gender, shift_schedule, hire_date],
    );

    await pool.execute("UPDATE users SET role = 'admin' WHERE user_id = ?", [
      user_id,
    ]);
    await recordAudit(req, {
      action: "PROMOTE_USER",
      entityType: "user",
      entityId: user_id,
      description: `Promoted ${users[0].first_name} ${users[0].last_name} to staff`,
      oldValues: { role: users[0].role },
      newValues: {
        role: "admin",
        profile_type: "staff",
        staff_id: result.insertId,
        shift_schedule,
      },
    });
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
