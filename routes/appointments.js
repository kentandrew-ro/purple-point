"use strict";

const { pool } = require("../lib/database");
const { INTERNAL_ERROR_MESSAGE, requireField } = require("../lib/http");
const {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  parsePositiveInteger,
} = require("../lib/businessRules");
const { recordAudit } = require("../lib/audit");

function registerAppointmentRoutes(app) {
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
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
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
          return res
            .status(404)
            .json({ ok: false, error: "Patient not found." });
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
      const dentist_id = parsePositiveInteger(dentist_id_raw);

      const missing = [];
      if (!appointment_date) missing.push("appointment_date");
      if (!appointment_time) missing.push("appointment_time");
      if (!appointment_type) missing.push("appointment_type");
      if (!dentist_id_raw) missing.push("dentist_id");
      if (!appointment_status) missing.push("status");

      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing field(s): ${missing.join(", ")}`,
        });
      }

      if (!dentist_id) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid dentist_id." });
      }

      const [dentists] = await pool.execute(
        "SELECT dentist_id FROM dentist WHERE dentist_id = ?",
        [dentist_id],
      );
      if (!dentists.length) {
        return res.status(404).json({ ok: false, error: "Dentist not found." });
      }

      if (!APPOINTMENT_TYPES.includes(appointment_type)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid appointment_type." });
      }

      if (!APPOINTMENT_STATUSES.includes(appointment_status)) {
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
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

    if (
      !appointment_status ||
      !APPOINTMENT_STATUSES.includes(appointment_status)
    ) {
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
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
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
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
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    }
  });
}

module.exports = { registerAppointmentRoutes };
