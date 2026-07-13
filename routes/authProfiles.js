"use strict";

const bcrypt = require("bcrypt");
const { pool } = require("../lib/database");
const { INTERNAL_ERROR_MESSAGE, requireField } = require("../lib/http");
const {
  getDoctorProfileValidationError,
  isIsoDate,
  validateGender,
} = require("../lib/businessRules");
const { createAuditLog, recordAudit } = require("../lib/audit");

function registerAuthProfileRoutes(
  app,
  { sessionCookieName = "purplepoint.sid", isProduction = false } = {},
) {
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
    const normalizedIdentifier =
      typeof identifier === "string" ? identifier.trim() : "";

    if (!normalizedIdentifier || typeof password !== "string" || !password) {
      return res
        .status(400)
        .json({ error: "Username/email and password are required." });
    }

    try {
      const [rows] = await pool.execute(
        `SELECT * FROM users
         WHERE username = ? OR LOWER(TRIM(email)) = LOWER(?)
         LIMIT 1`,
        [normalizedIdentifier, normalizedIdentifier],
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: "Invalid username or password." });
      }

      const user = rows[0];
      const match = await bcrypt.compare(password, user.password_hash);

      if (match) {
        await new Promise((resolve, reject) => {
          req.session.regenerate((error) =>
            error ? reject(error) : resolve(),
          );
        });
        req.session.userId = user.user_id;
        req.session.role = user.role;
        await new Promise((resolve, reject) => {
          req.session.save((error) => (error ? reject(error) : resolve()));
        });
        let profileComplete = true;
        if (user.role === "patient") {
          const [profiles] = await pool.execute(
            `SELECT p.patient_id
             FROM patients p
             JOIN patient_records pr ON pr.patient_id = p.patient_id
             WHERE p.user_id = ?
               AND TRIM(pr.emergency_contact_name) <> ''
               AND TRIM(pr.emergency_contact_number) <> ''
             LIMIT 1`,
            [user.user_id],
          );
          profileComplete = profiles.length > 0;
        }

        return res.status(200).json({
          message: "Login successful!",
          role: user.role,
          profileComplete,
        });
      } else {
        return res.status(401).json({ error: "Invalid username or password." });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy((error) => {
      if (error) {
        console.error(error);
        return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
      }
      res.clearCookie(sessionCookieName, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        path: "/",
      });
      return res.json({ message: "Logged out successfully." });
    });
  });

  app.get("/api/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }

    try {
      const [rows] = await pool.execute(
        `SELECT first_name, last_name, username, email, contact_number, role
         FROM users
         WHERE user_id = ?`,
        [req.session.userId],
      );

      if (!rows.length) {
        return res.status(404).json({ error: "User account not found" });
      }

      const user = rows[0];
      return res.json({
        userId: req.session.userId,
        firstName: user.first_name,
        lastName: user.last_name,
        username: user.username,
        email: user.email,
        contactNumber: user.contact_number,
        role: user.role || req.session.role,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/patients/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }

    try {
      const [rows] = await pool.execute(
        `SELECT p.*, u.first_name, u.last_name, u.contact_number, u.email,
                pr.patient_records_id, pr.emergency_contact_name,
                pr.emergency_contact_number,
                COALESCE(pr.patient_status, 'active') AS patient_status,
                DATE_FORMAT(pr.date_registered, '%Y-%m-%d') AS date_registered
         FROM users u
         LEFT JOIN patients p ON p.user_id = u.user_id
         LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
         WHERE u.user_id = ?`,
        [req.session.userId],
      );

      if (!rows.length) {
        return res.status(404).json({ ok: false, error: "User not found" });
      }

      return res.json({
        ok: true,
        profileComplete: Boolean(
          rows[0].patient_id &&
          rows[0].patient_records_id &&
          rows[0].emergency_contact_name &&
          rows[0].emergency_contact_number,
        ),
        patient: rows[0],
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.put("/api/patients/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }

    let conn;
    try {
      conn = await pool.getConnection();
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
      const emergency_contact_name = requireField(
        body,
        "emergency_contact_name",
      );
      const emergency_contact_number = requireField(
        body,
        "emergency_contact_number",
      );
      const patient_status = requireField(body, "patient_status") || "active";

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
      if (!emergency_contact_name) missing.push("emergency_contact_name");
      if (!emergency_contact_number) missing.push("emergency_contact_number");

      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing field(s): ${missing.join(", ")}`,
        });
      }

      const normalizedGender = gender.toLowerCase();
      if (!["male", "female"].includes(normalizedGender)) {
        return res.status(400).json({ ok: false, error: "Invalid gender." });
      }

      const normalizedPatientStatus = patient_status.toLowerCase();
      if (
        !["active", "inactive", "archived"].includes(normalizedPatientStatus)
      ) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid patient_status." });
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

      await conn.execute(
        `INSERT INTO patient_records
           (patient_id, emergency_contact_name, emergency_contact_number, patient_status)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           emergency_contact_name = VALUES(emergency_contact_name),
           emergency_contact_number = VALUES(emergency_contact_number),
           patient_status = VALUES(patient_status)`,
        [
          patientId,
          emergency_contact_name,
          emergency_contact_number,
          normalizedPatientStatus,
        ],
      );

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
          emergency_contact_name,
          emergency_contact_number,
          patient_status: normalizedPatientStatus,
        },
      });
      await conn.commit();
      return res.json({ ok: true, message: "Profile saved successfully." });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (_) {}
      }
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
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
      const genderRaw =
        requireField(body, "gender") || requireField(body, "sex");
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
        return res.status(409).json({
          ok: false,
          error: "This user already has a patient profile.",
        });
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.post("/api/doctors", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }
    if (req.session.role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    let conn;
    try {
      conn = await pool.getConnection();
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
      const license_number = requireField(body, "license_number");

      const gender = validateGender(genderRaw);

      const missing = [];
      if (!user_id) missing.push("user_id");
      if (!date_of_birth) missing.push("date_of_birth");
      if (!gender) missing.push("gender (male/female)");
      if (!hire_date) missing.push("hire_date");
      if (!specialization) missing.push("specialization");
      if (!license_number) missing.push("license_number");

      if (missing.length) {
        await conn.rollback();
        return res.status(400).json({
          ok: false,
          error: `Missing required field(s): ${missing.join(", ")}`,
        });
      }

      const profileValidationError = getDoctorProfileValidationError({
        dateOfBirth: date_of_birth,
        hireDate: hire_date,
        specialization,
        licenseNumber: license_number,
      });
      if (profileValidationError) {
        await conn.rollback();
        return res.status(400).json({
          ok: false,
          error: profileValidationError,
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
        return res.status(409).json({
          ok: false,
          error: "This user already has a doctor profile.",
        });
      }

      const [licenseMatches] = await conn.execute(
        "SELECT dentist_id FROM dentist WHERE license_number = ?",
        [license_number],
      );
      if (licenseMatches.length) {
        await conn.rollback();
        return res.status(409).json({
          ok: false,
          error: "This license number is already assigned to another doctor.",
        });
      }

      const [dentistResult] = await conn.execute(
        `INSERT INTO dentist (
          user_id, date_of_birth, gender, specialization, license_number, hire_date
        ) VALUES (
          :user_id, :date_of_birth, :gender, :specialization, :license_number, :hire_date
        )`,
        {
          user_id,
          date_of_birth,
          gender,
          specialization,
          license_number,
          hire_date,
        },
      );

      await conn.commit();
      return res.json({ ok: true, doctor_id: dentistResult.insertId });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (_) {}
      }
      console.error(err);
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          ok: false,
          error: "The user or license number already has a doctor profile.",
        });
      }
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
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
        return res.status(400).json({
          ok: false,
          error: `Missing field(s): ${missing.join(", ")}`,
        });
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
        return res
          .status(400)
          .json({ ok: false, error: "Invalid day_of_week." });
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

      const [overlapping] = await pool.execute(
        `SELECT schedule_id
         FROM dentist_schedule
         WHERE dentist_id = ?
           AND day_of_week = ?
           AND is_active = TRUE
           AND start_time < TIME(?)
           AND end_time > TIME(?)
         LIMIT 1`,
        [dentist_id, day_of_week, end_time, start_time],
      );
      if (overlapping.length) {
        return res.status(409).json({
          ok: false,
          error:
            "This clinic-hours entry overlaps an existing active schedule.",
        });
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });
}

module.exports = { registerAuthProfileRoutes };
