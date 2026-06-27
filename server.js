require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcrypt");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "purple_point",
  connectionLimit: 5,
});

function requireField(obj, key) {
  const v = obj?.[key];
  if (v === undefined || v === null) return null;
  return String(v).trim();
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
    const email = requireField(body, "email");
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
    if (!email) missing.push("email");
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
          contact_number = ?, email = ?, house_no = ?, street = ?,
          barangay = ?, city = ?, zip_code = ?, blood_type = ?
        WHERE user_id = ?`,
        [
          first_name,
          last_name,
          date_of_birth,
          normalizedGender,
          contact_number,
          email,
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
           contact_number, email, house_no, street, barangay, city, zip_code, blood_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.session.userId,
          first_name,
          last_name,
          date_of_birth,
          normalizedGender,
          contact_number,
          email,
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

    const validStatuses = ["scheduled", "completed", "cancelled"];
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

app.get("/patientPage.html", (req, res) => {
  if (!req.session.userId) return res.redirect("/login.html");
  if (req.session.role !== "patient") return res.redirect("/adminPage.html");
  res.sendFile(
    path.join(__dirname, "protected", "patient", "patientPage.html"),
  );
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

app.listen(PORT, () => {});
