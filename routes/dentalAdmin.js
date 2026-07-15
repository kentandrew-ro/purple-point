"use strict";

const { pool } = require("../lib/database");
const {
  INTERNAL_ERROR_MESSAGE,
  requireField,
  requireRole,
} = require("../lib/http");
const {
  APPOINTMENT_TYPES,
  doctorMatchesAppointmentType,
  getDoctorProfileValidationError,
  isValidEmail,
  isIsoDate,
  parsePositiveInteger,
  validateGender,
} = require("../lib/businessRules");
const { createAuditLog, recordAudit } = require("../lib/audit");
const {
  getAllergyValidationError,
  normalizeAllergies,
  normalizeDiabetesStatus,
  replacePatientAllergies,
} = require("../lib/medicalProfile");

async function getToothChartTreatmentValue(executor, dentalRecordId) {
  const [rows] = await executor.execute(
    `SELECT tooth_number
     FROM tooth_chart
     WHERE dental_record_id = ?
       AND condition_status <> 'healthy'
     ORDER BY tooth_number`,
    [dentalRecordId],
  );
  if (!rows.length) return null;
  return rows.map((row) => `#${row.tooth_number}`).join(", ");
}

async function syncTreatmentTeethFromChart(executor, dentalRecordId) {
  const teethInvolved = await getToothChartTreatmentValue(
    executor,
    dentalRecordId,
  );
  await executor.execute(
    "UPDATE dental_records SET teeth_involved = ? WHERE dental_record_id = ?",
    [teethInvolved, dentalRecordId],
  );
  await executor.execute(
    "UPDATE patient_treatments SET teeth_involved = ? WHERE dental_record_id = ?",
    [teethInvolved, dentalRecordId],
  );
  return teethInvolved;
}

function registerDentalAdminRoutes(app) {
  app.get("/api/admin/users/search", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin"])) return;

    try {
      const q = requireField(req.query, "q");
      if (!q) return res.json([]);

      const search = `%${q}%`;
      const [rows] = await pool.execute(
        `SELECT u.user_id, u.first_name, u.last_name, u.username, u.email, u.contact_number, u.role,
                p.date_of_birth, p.gender
           FROM users u
           LEFT JOIN patients p ON p.user_id = u.user_id
          WHERE u.role = 'patient'
            AND u.user_id <> ?
            AND (
              u.first_name LIKE ?
              OR u.last_name LIKE ?
              OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?
              OR u.username LIKE ?
              OR u.email LIKE ?
              OR u.contact_number LIKE ?
            )
          LIMIT 12`,
        [req.session.userId, search, search, search, search, search, search],
      );

      return res.json(
        rows.map((row) => ({
          user_id: row.user_id,
          first_name: row.first_name,
          last_name: row.last_name,
          username: row.username,
          email: row.email,
          contact_number: row.contact_number,
          role: row.role === "admin" ? "superadmin" : row.role,
          date_of_birth: row.date_of_birth,
          gender: row.gender,
        })),
      );
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/patients/search", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

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
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/patients/:id", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

    const patientId = parseInt(req.params.id, 10);
    if (!patientId) {
      return res.status(400).json({ ok: false, error: "Invalid patient ID." });
    }

    try {
      const [rows] = await pool.execute(
        `SELECT
           p.patient_id, p.user_id, u.first_name, u.last_name,
           DATE_FORMAT(p.date_of_birth, '%Y-%m-%d') AS date_of_birth,
           p.gender, u.contact_number,
           p.house_no, p.street, p.barangay, p.city, p.zip_code,
           p.blood_type, p.created_at, u.email,
           DATE_FORMAT(pr.date_registered, '%Y-%m-%d') AS date_registered,
           ec.contact_name AS emergency_contact_name,
           ec.contact_number AS emergency_contact_number,
           COALESCE(pmp.diabetes_status, 'unknown') AS diabetes_status,
           COALESCE(pr.patient_status, 'active') AS patient_status
         FROM patients p
         LEFT JOIN users u ON u.user_id = p.user_id
         LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
         LEFT JOIN emergency_contacts ec ON ec.patient_id = p.patient_id
         LEFT JOIN patient_medical_profiles pmp ON pmp.patient_id = p.patient_id
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
      const [allergyRows] = await pool.execute(
        `SELECT allergen
         FROM patient_allergies
         WHERE patient_id = ?
         ORDER BY allergen`,
        [patientId],
      );

      return res.json({
        ok: true,
        patient: {
          ...rows[0],
          appointment_count: appointmentCountRow?.appointment_count || 0,
          allergies: allergyRows.map((row) => row.allergen),
        },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.patch("/api/patients/:id/information", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

    const patientId = parseInt(req.params.id, 10);
    if (!patientId) {
      return res.status(400).json({ ok: false, error: "Invalid patient ID." });
    }

    const body = req.body || {};
    const editableFields = {
      email: requireField(body, "email")?.toLowerCase(),
      contact_number: requireField(body, "contact_number"),
      house_no: requireField(body, "house_no"),
      street: requireField(body, "street"),
      barangay: requireField(body, "barangay"),
      city: requireField(body, "city"),
      zip_code: requireField(body, "zip_code"),
      emergency_contact_name: requireField(body, "emergency_contact_name"),
      emergency_contact_number: requireField(
        body,
        "emergency_contact_number",
      ),
    };
    const diabetesStatus = normalizeDiabetesStatus(
      requireField(body, "diabetes_status"),
    );
    const allergies = normalizeAllergies(body.allergies);
    const allergyError = getAllergyValidationError(allergies);
    const missing = Object.entries(editableFields)
      .filter(([, value]) => !value)
      .map(([field]) => field);
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing field(s): ${missing.join(", ")}`,
      });
    }
    if (!isValidEmail(editableFields.email)) {
      return res.status(400).json({
        ok: false,
        error:
          "Enter a valid email address with @ and a domain such as .com or .ph.",
      });
    }
    if (!diabetesStatus) {
      return res.status(400).json({
        ok: false,
        error: "Diabetes status must be unknown, no, or yes.",
      });
    }
    if (allergyError) {
      return res.status(400).json({ ok: false, error: allergyError });
    }

    const maximumLengths = {
      email: 100,
      contact_number: 20,
      house_no: 20,
      street: 255,
      barangay: 100,
      city: 100,
      zip_code: 20,
      emergency_contact_name: 150,
      emergency_contact_number: 20,
    };
    const tooLong = Object.entries(maximumLengths).find(
      ([field, maximum]) => editableFields[field].length > maximum,
    );
    if (tooLong) {
      return res.status(400).json({
        ok: false,
        error: `${tooLong[0]} must not exceed ${tooLong[1]} characters.`,
      });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT p.patient_id, p.user_id,
                u.email, u.contact_number,
                p.house_no, p.street, p.barangay, p.city, p.zip_code,
                ec.contact_name AS emergency_contact_name,
                ec.contact_number AS emergency_contact_number,
                COALESCE(pmp.diabetes_status, 'unknown') AS diabetes_status
         FROM patients p
         JOIN users u ON u.user_id = p.user_id
         LEFT JOIN emergency_contacts ec ON ec.patient_id = p.patient_id
         LEFT JOIN patient_medical_profiles pmp ON pmp.patient_id = p.patient_id
         WHERE p.patient_id = ?
         FOR UPDATE`,
        [patientId],
      );
      if (!rows.length) {
        await conn.rollback();
        return res.status(404).json({ ok: false, error: "Patient not found." });
      }
      const [oldAllergyRows] = await conn.execute(
        `SELECT allergen
         FROM patient_allergies
         WHERE patient_id = ?
         ORDER BY allergen`,
        [patientId],
      );

      await conn.execute(
        "UPDATE users SET email = ?, contact_number = ? WHERE user_id = ?",
        [editableFields.email, editableFields.contact_number, rows[0].user_id],
      );
      await conn.execute(
        `UPDATE patients
         SET house_no = ?, street = ?, barangay = ?, city = ?, zip_code = ?
         WHERE patient_id = ?`,
        [
          editableFields.house_no,
          editableFields.street,
          editableFields.barangay,
          editableFields.city,
          editableFields.zip_code,
          patientId,
        ],
      );
      await conn.execute(
        `INSERT INTO emergency_contacts
           (patient_id, contact_name, contact_number)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           contact_name = VALUES(contact_name),
           contact_number = VALUES(contact_number)`,
        [
          patientId,
          editableFields.emergency_contact_name,
          editableFields.emergency_contact_number,
        ],
      );
      await conn.execute(
        `INSERT INTO patient_records (patient_id)
         VALUES (?)
         ON DUPLICATE KEY UPDATE patient_id = VALUES(patient_id)`,
        [patientId],
      );
      await conn.execute(
        `INSERT INTO patient_medical_profiles (patient_id, diabetes_status)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE
           diabetes_status = VALUES(diabetes_status)`,
        [patientId, diabetesStatus],
      );
      await replacePatientAllergies(conn, patientId, allergies);
      await createAuditLog(conn, req, {
        action: "UPDATE_PATIENT",
        entityType: "patient",
        entityId: patientId,
        description: `Updated patient information for patient #${patientId}`,
        oldValues: {
          email: rows[0].email,
          contact_number: rows[0].contact_number,
          house_no: rows[0].house_no,
          street: rows[0].street,
          barangay: rows[0].barangay,
          city: rows[0].city,
          zip_code: rows[0].zip_code,
          emergency_contact_name: rows[0].emergency_contact_name,
          emergency_contact_number: rows[0].emergency_contact_number,
          diabetes_status: rows[0].diabetes_status,
          allergies: oldAllergyRows.map((row) => row.allergen),
        },
        newValues: {
          ...editableFields,
          diabetes_status: diabetesStatus,
          allergies,
        },
      });
      await conn.commit();
      return res.json({
        ok: true,
        message: "Patient information updated successfully.",
      });
    } catch (err) {
      if (conn) await conn.rollback();
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          ok: false,
          error: "That email address is already assigned to another account.",
        });
      }
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
    }
  });

  app.get("/api/patients/:id/status", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

    const patientId = parseInt(req.params.id, 10);
    if (!patientId) {
      return res.status(400).json({ ok: false, error: "Invalid patient ID." });
    }

    try {
      const [rows] = await pool.execute(
        `SELECT p.patient_id,
                CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                pr.patient_records_id,
                COALESCE(pr.patient_status, 'active') AS patient_status
         FROM patients p
         JOIN users u ON u.user_id = p.user_id
         LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
         WHERE p.patient_id = ?`,
        [patientId],
      );
      if (!rows.length) {
        return res.status(404).json({ ok: false, error: "Patient not found." });
      }
      return res.json({ ok: true, patient: rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.patch("/api/patients/:id/status", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

    const patientId = parseInt(req.params.id, 10);
    const patientStatus = requireField(
      req.body || {},
      "patient_status",
    )?.toLowerCase();
    if (!patientId) {
      return res.status(400).json({ ok: false, error: "Invalid patient ID." });
    }
    if (
      !patientStatus ||
      !["active", "inactive", "archived"].includes(patientStatus)
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid patient status." });
    }

    try {
      const [rows] = await pool.execute(
        `SELECT pr.patient_records_id, pr.patient_status,
                CONCAT(u.first_name, ' ', u.last_name) AS patient_name
         FROM patients p
         JOIN users u ON u.user_id = p.user_id
         LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
         WHERE p.patient_id = ?`,
        [patientId],
      );
      if (!rows.length) {
        return res.status(404).json({ ok: false, error: "Patient not found." });
      }
      if (!rows[0].patient_records_id) {
        return res.status(409).json({
          ok: false,
          error:
            "The patient must complete their profile before status can be changed.",
        });
      }

      await pool.execute(
        "UPDATE patient_records SET patient_status = ? WHERE patient_id = ?",
        [patientStatus, patientId],
      );
      await recordAudit(req, {
        action: "UPDATE_PATIENT_STATUS",
        entityType: "patient",
        entityId: patientId,
        description: `Changed ${rows[0].patient_name} status to ${patientStatus}`,
        oldValues: { patient_status: rows[0].patient_status },
        newValues: { patient_status: patientStatus },
      });

      return res.json({
        ok: true,
        message: "Patient status updated.",
        patient_status: patientStatus,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/dentists", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });

    try {
      const appointmentDate = requireField(req.query, "appointment_date");
      const appointmentTime = requireField(req.query, "appointment_time");
      const appointmentType = (
        requireField(req.query, "appointment_type") || ""
      ).toLowerCase();

      if (appointmentType && !APPOINTMENT_TYPES.includes(appointmentType)) {
        return res.status(400).json({ error: "Invalid appointment type." });
      }

      const filterByAppointmentType = (dentists) => {
        if (!appointmentType) return dentists;
        return dentists.filter((dentist) =>
          doctorMatchesAppointmentType(
            appointmentType,
            dentist.specialization,
          ),
        );
      };

      if (
        (appointmentDate && !appointmentTime) ||
        (!appointmentDate && appointmentTime)
      ) {
        return res.status(400).json({
          error:
            "appointment_date and appointment_time must be provided together.",
        });
      }

      if (appointmentDate || appointmentTime) {
        const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
        if (!isIsoDate(appointmentDate) || !timePattern.test(appointmentTime)) {
          return res
            .status(400)
            .json({ error: "Invalid appointment date or time." });
        }

        const [availableRows] = await pool.execute(
          `SELECT DISTINCT d.dentist_id, u.first_name, u.last_name,
                  d.specialization, d.license_number,
                  DATE_FORMAT(d.hire_date, '%Y-%m-%d') AS hire_date
           FROM dentist d
           JOIN users u ON u.user_id = d.user_id
           JOIN dentist_schedule ds ON ds.dentist_id = d.dentist_id
           WHERE ds.is_active = TRUE
             AND ds.day_of_week = DAYNAME(?)
             AND TIME(?) >= ds.start_time
             AND TIME(?) < ds.end_time
             AND NOT EXISTS (
               SELECT 1
               FROM appointments a
               WHERE a.dentist_id = d.dentist_id
                 AND a.appointment_date = ?
                 AND a.appointment_time = ?
                 AND a.appointment_status <> 'cancelled'
             )
           ORDER BY u.first_name, u.last_name`,
          [
            appointmentDate,
            appointmentTime,
            appointmentTime,
            appointmentDate,
            appointmentTime,
          ],
        );
        return res.json(filterByAppointmentType(availableRows));
      }

      const [rows] = await pool.execute(
        `SELECT d.dentist_id, u.first_name, u.last_name, d.specialization,
                d.license_number, DATE_FORMAT(d.hire_date, '%Y-%m-%d') AS hire_date
         FROM dentist d
         JOIN users u ON u.user_id = d.user_id
         ORDER BY u.first_name, u.last_name`,
      );
      return res.json(filterByAppointmentType(rows));
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/dentists/search", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

    try {
      const q = requireField(req.query, "q");
      if (!q) return res.json([]);
      const search = `%${q}%`;
      const [rows] = await pool.execute(
        `SELECT d.dentist_id, u.first_name, u.last_name, d.specialization,
                d.license_number, DATE_FORMAT(d.hire_date, '%Y-%m-%d') AS hire_date,
                u.email
           FROM dentist d
           JOIN users u ON u.user_id = d.user_id
          WHERE u.first_name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.first_name, ' ', u.last_name) LIKE ? OR u.email LIKE ? OR d.specialization LIKE ? OR d.license_number LIKE ?
          LIMIT 12`,
        [search, search, search, search, search, search],
      );
      return res.json(rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    }
  });

  const TOOTH_STATUSES = ["healthy", "treated", "needs_attention", "extracted"];

  app.get("/api/appointments/patient/:patientId", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor"])) return;

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
           dr.dental_record_id,
           EXISTS(
             SELECT 1 FROM patient_treatments pt
             WHERE pt.dental_record_id = dr.dental_record_id
           ) AS has_treatment,
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/dental-records/patient/:patientId", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor"])) return;

    const patientId = parseInt(req.params.patientId, 10);
    if (!patientId) {
      return res.status(400).json({ ok: false, error: "Invalid patient ID." });
    }

    try {
      const [patientRows] = await pool.execute(
        `SELECT
           p.patient_id, u.first_name, u.last_name, p.blood_type, p.date_of_birth,
           COALESCE(pr.patient_status, 'active') AS status,
           COALESCE(pmp.diabetes_status, 'unknown') AS diabetes_status
         FROM patients p
         LEFT JOIN users u ON u.user_id = p.user_id
         LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
         LEFT JOIN patient_medical_profiles pmp ON pmp.patient_id = p.patient_id
         WHERE p.patient_id = ?`,
        [patientId],
      );

      if (!patientRows.length) {
        return res.status(404).json({ ok: false, error: "Patient not found." });
      }

      const [allergyRows] = await pool.execute(
        `SELECT allergen
         FROM patient_allergies
         WHERE patient_id = ?
         ORDER BY allergen`,
        [patientId],
      );

      const [toothRows] = await pool.execute(
        `SELECT dr.dental_record_id, tc.tooth_number, tc.condition_status,
                dr.appointment_id,
                dr.teeth_involved,
                DATE_FORMAT(dr.visit_date, '%Y-%m-%d') AS visit_date
         FROM dental_records dr
         LEFT JOIN tooth_chart tc ON tc.dental_record_id = dr.dental_record_id
         WHERE dr.patient_id = ?
         ORDER BY dr.visit_date DESC, dr.dental_record_id DESC,
                  tc.recorded_at DESC, tc.tooth_chart_id DESC`,
        [patientId],
      );
      const toothChartsByRecord = new Map();
      const toothRecordMetadata = new Map();
      toothRows.forEach((row) => {
        const recordId = String(row.dental_record_id);
        if (!toothChartsByRecord.has(recordId)) {
          toothChartsByRecord.set(recordId, {});
        }
        const chart = toothChartsByRecord.get(recordId);
        if (
          row.tooth_number !== null &&
          !Object.prototype.hasOwnProperty.call(chart, row.tooth_number)
        ) {
          chart[row.tooth_number] = row.condition_status;
        }
        if (!toothRecordMetadata.has(recordId)) {
          toothRecordMetadata.set(recordId, {
            dental_record_id: row.dental_record_id,
            appointment_id: row.appointment_id,
            date: row.visit_date,
            teeth: row.teeth_involved || "—",
          });
        }
      });

      const [vitalsRows] = await pool.execute(
        `SELECT
           dr.appointment_id,
           DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
           DATE_FORMAT(a.appointment_time, '%H:%i:%s') AS appointment_time,
           DATE_FORMAT(pv.date_recorded, '%Y-%m-%d') AS date_recorded,
           pv.blood_pressure, pv.heart_rate, pv.temperature
         FROM patient_vitals pv
         JOIN dental_records dr ON dr.dental_record_id = pv.dental_record_id
         LEFT JOIN appointments a ON a.appointment_id = dr.appointment_id
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
           AND (
             pt.patient_treatment_id IS NOT NULL
             OR NULLIF(TRIM(dr.treatment_plan_notes), '') IS NOT NULL
           )
         ORDER BY dr.visit_date DESC, dr.dental_record_id DESC`,
        [patientId],
      );

      const treatments = treatmentRows.map((row) => ({
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
      }));
      const toothCharts = treatments.map((treatment) => ({
        dental_record_id: treatment.treatment_id,
        appointment_id: treatment.appointment_id,
        date: treatment.date,
        procedure: treatment.procedure,
        teeth: treatment.teeth,
        doctor: treatment.doctor,
        tooth_chart:
          toothChartsByRecord.get(String(treatment.treatment_id)) || {},
      }));
      const treatmentRecordIds = new Set(
        treatments.map((treatment) => String(treatment.treatment_id)),
      );
      toothRecordMetadata.forEach((metadata, recordId) => {
        if (treatmentRecordIds.has(recordId)) return;
        toothCharts.push({
          ...metadata,
          procedure: metadata.appointment_id
            ? "Appointment dental record"
            : "Unlinked dental record",
          doctor: "—",
          tooth_chart: toothChartsByRecord.get(recordId) || {},
        });
      });

      return res.json({
        ok: true,
        patient: {
          patient_id: patient.patient_id,
          name: `${patient.first_name} ${patient.last_name}`.trim(),
          blood_type: patient.blood_type,
          date_of_birth: patient.date_of_birth,
          status: patient.status,
          diabetes_status: patient.diabetes_status,
          allergies: allergyRows.map((row) => row.allergen),
        },
        tooth_charts: toothCharts,
        treatments,
        vitals: vitalsRows.map((row) => ({
          appointment_id: row.appointment_id,
          appointment_date: row.appointment_date,
          appointment_time: row.appointment_time,
          date: row.date_recorded,
          bp: row.blood_pressure || "—",
          pulse: row.heart_rate || "—",
          temp: row.temperature || "—",
        })),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.put("/api/dental-records/:id", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor"])) return;

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
      const notes = requireField(body, "notes") || null;
      const price_raw = requireField(body, "price");
      const price = price_raw !== null ? parseFloat(price_raw) : 0;
      const duration_raw = requireField(body, "duration");
      const duration =
        duration_raw !== null ? parseInt(duration_raw, 10) : null;
      const category = requireField(body, "category") || "dental";

      const missing = [];
      if (!visit_date) missing.push("visit_date");
      if (!procedure) missing.push("procedure");

      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing field(s): ${missing.join(", ")}`,
        });
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
          return res
            .status(404)
            .json({ ok: false, error: "Dentist not found." });
        }
      }

      const teeth_involved = await getToothChartTreatmentValue(pool, recordId);

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
          [
            teeth_involved,
            price,
            duration,
            existingLink[0].patient_treatment_id,
          ],
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.delete("/api/dental-records/:id/treatment", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor"])) return;

    const recordId = parseInt(req.params.id, 10);
    if (!recordId) {
      return res.status(400).json({ ok: false, error: "Invalid record ID." });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [rows] = await conn.execute(
        `SELECT
           dr.dental_record_id, dr.patient_id, dr.appointment_id,
           dr.treatment_plan_notes, dr.teeth_involved,
           pt.patient_treatment_id, pt.treatment_id,
           pt.actual_price, pt.actual_duration,
           t.treatment_name, t.description, t.category,
           b.billing_id
         FROM dental_records dr
         LEFT JOIN patient_treatments pt
           ON pt.dental_record_id = dr.dental_record_id
         LEFT JOIN treatment t ON t.treatment_id = pt.treatment_id
         LEFT JOIN billing b
           ON b.patient_treatment_id = pt.patient_treatment_id
         WHERE dr.dental_record_id = ?
         FOR UPDATE`,
        [recordId],
      );

      if (!rows.length) {
        await conn.rollback();
        return res
          .status(404)
          .json({ ok: false, error: "Treatment record not found." });
      }

      const treatmentLinks = rows.filter(
        (row) => row.patient_treatment_id !== null,
      );
      const hasLegacyTreatment = Boolean(
        String(rows[0].treatment_plan_notes || "").trim(),
      );
      if (!treatmentLinks.length && !hasLegacyTreatment) {
        await conn.rollback();
        return res
          .status(404)
          .json({ ok: false, error: "No treatment exists on this record." });
      }

      if (rows.some((row) => row.billing_id !== null)) {
        await conn.rollback();
        return res.status(409).json({
          ok: false,
          error:
            "This treatment has a billing statement and cannot be deleted.",
        });
      }

      await conn.execute(
        "DELETE FROM patient_treatments WHERE dental_record_id = ?",
        [recordId],
      );

      const treatmentIds = [
        ...new Set(
          treatmentLinks
            .map((row) => row.treatment_id)
            .filter((treatmentId) => treatmentId !== null),
        ),
      ];
      for (const treatmentId of treatmentIds) {
        await conn.execute(
          `DELETE FROM treatment
           WHERE treatment_id = ?
             AND NOT EXISTS (
               SELECT 1 FROM patient_treatments
               WHERE treatment_id = ?
             )`,
          [treatmentId, treatmentId],
        );
      }

      // Keep the appointment-linked dental record for vitals and tooth-chart
      // history. With no patient_treatments link, the appointment becomes
      // selectable again and a replacement treatment reuses this record.
      await conn.execute(
        `UPDATE dental_records
         SET treatment_plan_notes = NULL, teeth_involved = NULL
         WHERE dental_record_id = ?`,
        [recordId],
      );

      await createAuditLog(conn, req, {
        action: "DELETE_TREATMENT",
        entityType: "treatment",
        entityId: treatmentLinks[0]?.patient_treatment_id || recordId,
        description: `Deleted treatment from dental record #${recordId}`,
        oldValues: {
          dental_record_id: recordId,
          patient_id: rows[0].patient_id,
          appointment_id: rows[0].appointment_id,
          treatments: treatmentLinks.map((row) => ({
            patient_treatment_id: row.patient_treatment_id,
            treatment_id: row.treatment_id,
            treatment_name: row.treatment_name,
            description: row.description,
            category: row.category,
            actual_price: row.actual_price,
            actual_duration: row.actual_duration,
          })),
          treatment_plan_notes: rows[0].treatment_plan_notes,
          teeth_involved: rows[0].teeth_involved,
        },
        newValues: null,
      });

      await conn.commit();
      return res.json({ ok: true, message: "Treatment deleted successfully." });
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (_) {}
      }
      console.error(err);
      if (err.code === "ER_ROW_IS_REFERENCED_2") {
        return res.status(409).json({
          ok: false,
          error:
            "This treatment is referenced by another record and cannot be deleted.",
        });
      }
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
    }
  });

  app.post("/api/dental-records", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor"])) return;

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
      const notes = requireField(body, "notes") || null;
      const price_raw = requireField(body, "price");
      const price = price_raw !== null ? parseFloat(price_raw) : 0;
      const duration_raw = requireField(body, "duration");
      const duration =
        duration_raw !== null ? parseInt(duration_raw, 10) : null;
      const category = requireField(body, "category") || "dental";
      let linkedDentalRecordId = null;
      let teeth_involved = null;

      const missing = [];
      if (!patient_id) missing.push("patient_id");
      if (!procedure) missing.push("procedure");

      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing field(s): ${missing.join(", ")}`,
        });
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
          `SELECT a.appointment_id, a.patient_id, a.dentist_id,
                  DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
                  dr.dental_record_id,
                  EXISTS(
                    SELECT 1 FROM patient_treatments pt
                    WHERE pt.dental_record_id = dr.dental_record_id
                  ) AS has_treatment
           FROM appointments a
           LEFT JOIN dental_records dr ON dr.appointment_id = a.appointment_id
           WHERE a.appointment_id = ?`,
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
        if (appointmentRows[0].has_treatment) {
          return res.status(409).json({
            ok: false,
            error: "This appointment already has a treatment.",
          });
        }
        linkedDentalRecordId = appointmentRows[0].dental_record_id || null;
        if (!dentist_id) dentist_id = appointmentRows[0].dentist_id;
        if (!visit_date) visit_date = appointmentRows[0].appointment_date;
      }

      if (!visit_date) missing.push("visit_date");
      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing field(s): ${missing.join(", ")}`,
        });
      }

      if (dentist_id) {
        const [dentists] = await pool.execute(
          "SELECT dentist_id FROM dentist WHERE dentist_id = ?",
          [dentist_id],
        );
        if (!dentists.length) {
          return res
            .status(404)
            .json({ ok: false, error: "Dentist not found." });
        }
      }

      // dental_records.recorded_by references users(user_id) — any logged-in
      // admin (staff, dentist, or plain admin) can record entries.
      const recorded_by = req.session.userId;

      let dentalRecordId = linkedDentalRecordId;
      if (dentalRecordId) {
        teeth_involved = await getToothChartTreatmentValue(
          pool,
          dentalRecordId,
        );
        await pool.execute(
          `UPDATE dental_records
           SET dentist_id = ?, visit_date = ?, treatment_plan_notes = ?, teeth_involved = ?
           WHERE dental_record_id = ?`,
          [dentist_id, visit_date, procedure, teeth_involved, dentalRecordId],
        );
      } else {
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
        dentalRecordId = result.insertId;
      }

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
        [
          dentalRecordId,
          newTreatment.insertId,
          teeth_involved,
          price,
          duration,
        ],
      );

      await recordAudit(req, {
        action: "CREATE_DENTAL_RECORD",
        entityType: "dental_record",
        entityId: dentalRecordId,
        description: `${linkedDentalRecordId ? "Updated" : "Created"} dental record #${dentalRecordId} for patient #${patient_id}`,
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
          treatment_id: dentalRecordId,
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.post("/api/patient-vitals", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor"])) return;

    let conn;
    try {
      const body = req.body || {};
      const patient_id = parseInt(requireField(body, "patient_id"), 10);
      const appointment_id = parsePositiveInteger(
        requireField(body, "appointment_id"),
      );
      const date_recorded = requireField(body, "date_recorded");
      const blood_pressure = requireField(body, "blood_pressure") || null;
      const heart_rate = requireField(body, "heart_rate") || null;
      const temperature = requireField(body, "temperature") || null;

      const missing = [];
      if (!patient_id) missing.push("patient_id");
      if (!appointment_id) missing.push("appointment_id");
      if (!date_recorded) missing.push("date_recorded");

      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing field(s): ${missing.join(", ")}`,
        });
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

      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [appointmentRows] = await conn.execute(
        `SELECT a.appointment_id, a.patient_id, a.dentist_id,
                DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
                dr.dental_record_id
         FROM appointments a
         LEFT JOIN dental_records dr ON dr.appointment_id = a.appointment_id
         WHERE a.appointment_id = ?
         LIMIT 1
         FOR UPDATE`,
        [appointment_id],
      );

      if (!appointmentRows.length) {
        await conn.rollback();
        return res
          .status(404)
          .json({ ok: false, error: "Appointment not found." });
      }
      if (appointmentRows[0].patient_id !== patient_id) {
        await conn.rollback();
        return res.status(400).json({
          ok: false,
          error: "That appointment does not belong to this patient.",
        });
      }

      let dental_record_id = appointmentRows[0].dental_record_id;
      if (!dental_record_id) {
        const [newRecord] = await conn.execute(
          `INSERT INTO dental_records
             (patient_id, appointment_id, dentist_id, recorded_by, visit_date)
           VALUES (?, ?, ?, ?, ?)`,
          [
            patient_id,
            appointment_id,
            appointmentRows[0].dentist_id,
            staff_id,
            appointmentRows[0].appointment_date,
          ],
        );
        dental_record_id = newRecord.insertId;
      }

      await conn.execute(
        `INSERT INTO patient_vitals
           (dental_record_id, staff_id, date_recorded, blood_pressure, heart_rate, temperature)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          dental_record_id,
          staff_id,
          date_recorded,
          blood_pressure,
          heart_rate,
          temperature,
        ],
      );
      await conn.commit();

      return res.status(201).json({
        ok: true,
        vitals: {
          appointment_id,
          date: date_recorded,
          bp: blood_pressure || "—",
          pulse: heart_rate || "—",
          temp: temperature || "—",
        },
      });
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

  app.put("/api/tooth-chart", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin", "doctor"])) return;

    const body = req.body || {};
    let dentalRecordId = parseInt(
      requireField(body, "dental_record_id"),
      10,
    );
    const appointmentId = parseInt(requireField(body, "appointment_id"), 10);
    const patientId = parseInt(requireField(body, "patient_id"), 10);
    const toothNumber = parseInt(requireField(body, "tooth_number"), 10);
    const conditionStatus = requireField(body, "condition_status");

    const missing = [];
    if (!dentalRecordId && (!appointmentId || !patientId)) {
      missing.push("dental_record_id or appointment_id and patient_id");
    }
    if (!toothNumber) missing.push("tooth_number");
    if (!conditionStatus) missing.push("condition_status");
    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing field(s): ${missing.join(", ")}`,
      });
    }
    if (toothNumber < 1 || toothNumber > 32) {
      return res
        .status(400)
        .json({ ok: false, error: "tooth_number must be between 1 and 32." });
    }
    if (!TOOTH_STATUSES.includes(conditionStatus)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid condition_status." });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      let records;
      if (dentalRecordId) {
        [records] = await conn.execute(
          `SELECT dental_record_id, patient_id, appointment_id
           FROM dental_records
           WHERE dental_record_id = ?
           FOR UPDATE`,
          [dentalRecordId],
        );
      } else {
        const [appointments] = await conn.execute(
          `SELECT appointment_id, patient_id, dentist_id,
                  DATE_FORMAT(appointment_date, '%Y-%m-%d') AS appointment_date
           FROM appointments
           WHERE appointment_id = ?
           FOR UPDATE`,
          [appointmentId],
        );
        if (!appointments.length) {
          await conn.rollback();
          return res
            .status(404)
            .json({ ok: false, error: "Appointment not found." });
        }
        if (appointments[0].patient_id !== patientId) {
          await conn.rollback();
          return res.status(400).json({
            ok: false,
            error: "That appointment does not belong to this patient.",
          });
        }

        [records] = await conn.execute(
          `SELECT dental_record_id, patient_id, appointment_id
           FROM dental_records
           WHERE appointment_id = ?
           FOR UPDATE`,
          [appointmentId],
        );
        if (!records.length) {
          const [newRecord] = await conn.execute(
            `INSERT INTO dental_records
               (patient_id, appointment_id, dentist_id, recorded_by, visit_date)
             VALUES (?, ?, ?, ?, ?)`,
            [
              patientId,
              appointmentId,
              appointments[0].dentist_id,
              req.session.userId,
              appointments[0].appointment_date,
            ],
          );
          dentalRecordId = newRecord.insertId;
          records = [
            {
              dental_record_id: dentalRecordId,
              patient_id: patientId,
              appointment_id: appointmentId,
            },
          ];
        } else {
          dentalRecordId = records[0].dental_record_id;
        }
      }
      if (!records.length) {
        await conn.rollback();
        return res
          .status(404)
          .json({ ok: false, error: "Dental record not found." });
      }

      const [updateResult] = await conn.execute(
        `UPDATE tooth_chart
         SET condition_status = ?
         WHERE dental_record_id = ? AND tooth_number = ?`,
        [conditionStatus, dentalRecordId, toothNumber],
      );
      if (!updateResult.affectedRows) {
        await conn.execute(
          `INSERT INTO tooth_chart (dental_record_id, tooth_number, condition_status)
           VALUES (?, ?, ?)`,
          [dentalRecordId, toothNumber, conditionStatus],
        );
      }

      const teethInvolved = await syncTreatmentTeethFromChart(
        conn,
        dentalRecordId,
      );

      await createAuditLog(conn, req, {
        action: "UPDATE_TOOTH_CHART",
        entityType: "tooth_chart",
        entityId: dentalRecordId,
        description: `Updated tooth #${toothNumber} on dental record #${dentalRecordId}`,
        newValues: {
          dental_record_id: dentalRecordId,
          appointment_id: records[0].appointment_id,
          tooth_number: toothNumber,
          condition_status: conditionStatus,
          teeth_involved: teethInvolved,
        },
      });
      await conn.commit();

      return res.json({
        ok: true,
        dental_record_id: dentalRecordId,
        tooth_number: toothNumber,
        condition_status: conditionStatus,
        teeth_involved: teethInvolved,
      });
    } catch (err) {
      if (conn) await conn.rollback();
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
    }
  });

  app.get("/api/admin/users/summary", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin"])) return;

    try {
      const [[{ total_doctors }]] = await pool.execute(
        "SELECT COUNT(*) AS total_doctors FROM dentist",
      );
      const [[{ total_staff }]] = await pool.execute(
        "SELECT COUNT(*) AS total_staff FROM staff",
      );
      const [doctors] = await pool.execute(
        `SELECT d.dentist_id, u.first_name, u.last_name, d.specialization,
                d.license_number, DATE_FORMAT(d.hire_date, '%Y-%m-%d') AS hire_date
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
          license_number: row.license_number,
          hire_date: row.hire_date,
        })),
        staff: staff.map((row) => ({
          id: row.staff_id,
          name: `${row.first_name} ${row.last_name}`,
          shift_schedule: row.shift_schedule,
        })),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.post("/api/admin/users/promote", async (req, res) => {
    if (!req.session.userId)
      return res.status(401).json({ error: "Not logged in" });
    if (!requireRole(req, res, ["superadmin"])) return;

    try {
      const body = req.body || {};
      const user_id = parseInt(requireField(body, "user_id"), 10);
      const role = requireField(body, "role");
      const date_of_birth = requireField(body, "date_of_birth");
      const gender = validateGender(requireField(body, "gender"));
      const hire_date = requireField(body, "hire_date");
      const specialization = requireField(body, "specialization");
      const license_number = requireField(body, "license_number");
      // employment_status column was removed from staff; no longer collected.
      const shift_schedule = requireField(body, "shift_schedule");
      const missing = [];
      if (!user_id) missing.push("user_id");
      if (!role) missing.push("role");
      if (!date_of_birth) missing.push("date_of_birth");
      if (!gender) missing.push("gender (male/female)");
      if (!hire_date) missing.push("hire_date");
      if (role === "doctor") {
        if (!specialization) missing.push("specialization");
        if (!license_number) missing.push("license_number");
      }
      if (role === "staff") {
        if (!shift_schedule) missing.push("shift_schedule");
      }

      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing field(s): ${missing.join(", ")}`,
        });
      }

      if (!["doctor", "staff"].includes(role)) {
        return res.status(400).json({ ok: false, error: "Invalid role." });
      }
      if (!isIsoDate(date_of_birth) || !isIsoDate(hire_date)) {
        return res.status(400).json({
          ok: false,
          error: "Date of birth and hire date must be valid dates.",
        });
      }
      if (role === "doctor") {
        const profileValidationError = getDoctorProfileValidationError({
          dateOfBirth: date_of_birth,
          hireDate: hire_date,
          specialization,
          licenseNumber: license_number,
        });
        if (profileValidationError) {
          return res
            .status(400)
            .json({ ok: false, error: profileValidationError });
        }
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
      if (user_id === req.session.userId || users[0].role !== "patient") {
        return res.status(409).json({
          ok: false,
          error:
            "Only another patient account can be assigned a staff or doctor role.",
        });
      }

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

        const [licenseMatches] = await pool.execute(
          "SELECT dentist_id FROM dentist WHERE license_number = ?",
          [license_number],
        );
        if (licenseMatches.length) {
          return res.status(409).json({
            ok: false,
            error: "This license number is already assigned to another doctor.",
          });
        }

        const [result] = await pool.execute(
          `INSERT INTO dentist (
             user_id, date_of_birth, gender, specialization, license_number, hire_date
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            user_id,
            date_of_birth,
            gender,
            specialization,
            license_number,
            hire_date,
          ],
        );

        await pool.execute(
          "UPDATE users SET role = 'doctor' WHERE user_id = ?",
          [user_id],
        );
        await recordAudit(req, {
          action: "ASSIGN_ROLE",
          entityType: "user",
          entityId: user_id,
          description: `Assigned doctor role to ${users[0].first_name} ${users[0].last_name}`,
          oldValues: { role: users[0].role },
          newValues: {
            role: "doctor",
            profile_type: "dentist",
            dentist_id: result.insertId,
            specialization,
            license_number,
            hire_date,
          },
        });
        return res.json({
          ok: true,
          doctor_id: result.insertId,
          role: "doctor",
        });
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

      await pool.execute("UPDATE users SET role = 'staff' WHERE user_id = ?", [
        user_id,
      ]);
      await recordAudit(req, {
        action: "ASSIGN_ROLE",
        entityType: "user",
        entityId: user_id,
        description: `Assigned staff role to ${users[0].first_name} ${users[0].last_name}`,
        oldValues: { role: users[0].role },
        newValues: {
          role: "staff",
          profile_type: "staff",
          staff_id: result.insertId,
          shift_schedule,
        },
      });
      return res.json({ ok: true, staff_id: result.insertId, role: "staff" });
    } catch (err) {
      console.error(err);
      if (err?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          ok: false,
          error:
            "The user or license number already has a staff or doctor profile.",
        });
      }
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });
}

module.exports = { registerDentalAdminRoutes };
