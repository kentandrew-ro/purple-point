"use strict";

const { pool } = require("../lib/database");
const {
  INTERNAL_ERROR_MESSAGE,
  normalizeRole,
  requireField,
  requireRole,
} = require("../lib/http");
const {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  doctorMatchesAppointmentType,
  isEmergencyAppointmentTime,
  isIsoDate,
  parsePositiveInteger,
} = require("../lib/businessRules");
const { recordAudit } = require("../lib/audit");

const EMERGENCY_WINDOW_ERROR =
  "Emergency appointments are only available from 6:00 AM to before 9:00 AM and from 4:00 PM to before 6:00 PM.";

async function markOverdueAppointments(executor = pool) {
  await executor.execute(
    `UPDATE appointments
     SET appointment_status = 'no_show'
     WHERE appointment_status = 'scheduled'
       AND appointment_date < CURDATE()`,
  );
}

function registerAppointmentRoutes(app) {
  app.get("/api/appointments", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not logged in" });
    }

    try {
      await markOverdueAppointments();
      let rows;

      const role = normalizeRole(req.session.role);
      if (["superadmin", "staff"].includes(role)) {
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
      } else if (role === "doctor") {
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
           JOIN dentist d ON d.dentist_id = a.dentist_id
           JOIN users du ON du.user_id = d.user_id
           WHERE d.user_id = ?
           ORDER BY a.appointment_date DESC, a.appointment_time DESC`,
          [req.session.userId],
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

    let bookingConn;
    try {
      const body = req.body || {};
      let patient_id;
      let patientProfile;

      const role = normalizeRole(req.session.role);
      const isManagementUser = ["superadmin", "staff", "doctor"].includes(
        role,
      );
      if (isManagementUser) {
        patient_id = parseInt(body.patient_id, 10);
        if (!patient_id) {
          return res
            .status(400)
            .json({ ok: false, error: "Missing field(s): patient_id" });
        }
        const [patients] = await pool.execute(
          `SELECT p.patient_id, pr.patient_records_id,
                  ec.emergency_contact_id,
                  ec.contact_name AS emergency_contact_name,
                  ec.contact_number AS emergency_contact_number,
                  pr.patient_status
           FROM patients p
           LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
           LEFT JOIN emergency_contacts ec ON ec.patient_id = p.patient_id
           WHERE p.patient_id = ?`,
          [patient_id],
        );
        if (!patients.length) {
          return res
            .status(404)
            .json({ ok: false, error: "Patient not found." });
        }
        patientProfile = patients[0];
      } else {
        const [rows] = await pool.execute(
          `SELECT p.patient_id, pr.patient_records_id,
                  ec.emergency_contact_id,
                  ec.contact_name AS emergency_contact_name,
                  ec.contact_number AS emergency_contact_number,
                  pr.patient_status
           FROM patients p
           LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
           LEFT JOIN emergency_contacts ec ON ec.patient_id = p.patient_id
           WHERE p.user_id = ?`,
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
        patientProfile = rows[0];
      }

      if (
        !patientProfile.patient_records_id ||
        !patientProfile.emergency_contact_id ||
        !patientProfile.emergency_contact_name ||
        !patientProfile.emergency_contact_number
      ) {
        return res.status(409).json({
          ok: false,
          error:
            "Patient must complete the profile before making appointments.",
        });
      }

      if (patientProfile.patient_status !== "active") {
        return res.status(409).json({
          ok: false,
          error: "Appointments can only be created for active patients.",
        });
      }

      const appointment_date = requireField(body, "appointment_date");
      const appointment_time = requireField(body, "appointment_time");
      const appointment_type = requireField(body, "appointment_type");
      const requestedAppointmentStatus = requireField(body, "status");
      const appointment_status = isManagementUser
        ? requestedAppointmentStatus
        : "scheduled";
      const reason_for_visit = requireField(body, "reason") || null;
      const dentist_id_raw = requireField(body, "dentist_id");
      let dentist_id = parsePositiveInteger(dentist_id_raw);
      const isEmergency = appointment_type === "emergency";

      const missing = [];
      if (!appointment_date) missing.push("appointment_date");
      if (!appointment_time) missing.push("appointment_time");
      if (!appointment_type) missing.push("appointment_type");
      if (!isEmergency && !dentist_id_raw) missing.push("dentist_id");
      if (isManagementUser && !appointment_status) missing.push("status");

      if (missing.length) {
        return res.status(400).json({
          ok: false,
          error: `Missing field(s): ${missing.join(", ")}`,
        });
      }

      if (!isEmergency && !dentist_id) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid dentist_id." });
      }

      const timePattern = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
      if (!isIsoDate(appointment_date) || !timePattern.test(appointment_time)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid appointment date or time.",
        });
      }

      if (!APPOINTMENT_TYPES.includes(appointment_type)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid appointment_type." });
      }

      if (isEmergency && !isEmergencyAppointmentTime(appointment_time)) {
        return res.status(409).json({ ok: false, error: EMERGENCY_WINDOW_ERROR });
      }

      if (isEmergency) {
        const [assignments] = await pool.execute(
          `SELECT dentist_id
           FROM emergency_duty_assignment
           WHERE assignment_id = 1 AND dentist_id IS NOT NULL`,
        );
        if (!assignments.length) {
          return res.status(409).json({
            ok: false,
            error:
              "Emergency booking is unavailable until a superadmin assigns an emergency doctor.",
          });
        }
        dentist_id = assignments[0].dentist_id;
      }

      const [dentists] = await pool.execute(
        "SELECT dentist_id, specialization FROM dentist WHERE dentist_id = ?",
        [dentist_id],
      );
      if (!dentists.length) {
        return res.status(404).json({ ok: false, error: "Dentist not found." });
      }
      if (
        !isEmergency &&
        !doctorMatchesAppointmentType(
          appointment_type,
          dentists[0].specialization,
        )
      ) {
        return res.status(409).json({
          ok: false,
          error:
            "The selected doctor's specialization does not match this appointment type.",
        });
      }

      if (!APPOINTMENT_STATUSES.includes(appointment_status)) {
        return res
          .status(400)
          .json({ ok: false, error: "Invalid appointment status." });
      }

      const [[dateCheck]] = await pool.execute(
        `SELECT TIMESTAMP(?, ?) >= NOW() AS is_bookable`,
        [appointment_date, appointment_time],
      );
      if (!dateCheck.is_bookable) {
        return res.status(400).json({
          ok: false,
          error: "Appointments must be scheduled for the present time or later.",
        });
      }

      if (!isEmergency) {
        const [availableSchedules] = await pool.execute(
          `SELECT schedule_id
           FROM dentist_schedule
           WHERE dentist_id = ?
             AND is_active = TRUE
             AND day_of_week = DAYNAME(?)
             AND TIME(?) >= start_time
             AND TIME(?) < end_time
           LIMIT 1`,
          [dentist_id, appointment_date, appointment_time, appointment_time],
        );
        if (!availableSchedules.length) {
          return res.status(409).json({
            ok: false,
            error: "The selected dentist is not scheduled at that date and time.",
          });
        }
      }

      bookingConn = await pool.getConnection();
      await bookingConn.beginTransaction();

      // Serialize booking attempts for the same dentist. The lock is held
      // through the conflict check and insert so concurrent requests cannot
      // both claim the same date and time.
      await bookingConn.execute(
        "SELECT dentist_id FROM dentist WHERE dentist_id = ? FOR UPDATE",
        [dentist_id],
      );

      const [conflicts] = await bookingConn.execute(
        `SELECT appointment_id
         FROM appointments
         WHERE dentist_id = ?
           AND appointment_date = ?
           AND appointment_time = ?
           AND appointment_status <> 'cancelled'
         LIMIT 1`,
        [dentist_id, appointment_date, appointment_time],
      );
      if (conflicts.length) {
        await bookingConn.rollback();
        return res.status(409).json({
          ok: false,
          error:
            "The selected dentist already has an appointment at that time.",
        });
      }

      const [result] = await bookingConn.execute(
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

      await bookingConn.commit();
      bookingConn.release();
      bookingConn = null;

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
      if (bookingConn) {
        try {
          await bookingConn.rollback();
        } catch (rollbackError) {
          console.error(rollbackError);
        }
      }
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (bookingConn) bookingConn.release();
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
      await markOverdueAppointments();
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
      if (existing[0].appointment_status !== "scheduled") {
        return res.status(409).json({
          ok: false,
          error: "Only scheduled appointments can be cancelled.",
        });
      }

      const role = normalizeRole(req.session.role);
      if (role === "doctor") {
        const [assignment] = await pool.execute(
          `SELECT a.appointment_id
           FROM appointments a
           JOIN dentist d ON d.dentist_id = a.dentist_id
           WHERE a.appointment_id = ? AND d.user_id = ?`,
          [appointmentId, req.session.userId],
        );
        if (!assignment.length) {
          return res.status(403).json({
            ok: false,
            error: "You can only update appointments assigned to you.",
          });
        }
      } else if (!["superadmin", "staff"].includes(role)) {
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
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

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
      await markOverdueAppointments();
      if (normalizeRole(req.session.role) === "doctor") {
        const [assignment] = await pool.execute(
          `SELECT a.appointment_id
           FROM appointments a
           JOIN dentist d ON d.dentist_id = a.dentist_id
           WHERE a.appointment_id = ? AND d.user_id = ?`,
          [appointmentId, req.session.userId],
        );
        if (!assignment.length) {
          return res.status(403).json({
            ok: false,
            error: "You can only update appointments assigned to you.",
          });
        }
      }

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
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

    try {
      await markOverdueAppointments();
      const [[{ total_patients }]] = await pool.execute(
        "SELECT COUNT(*) AS total_patients FROM patients",
      );

      const role = normalizeRole(req.session.role);
      const doctorFilter =
        role === "doctor"
          ? " AND EXISTS (SELECT 1 FROM dentist d WHERE d.dentist_id = appointments.dentist_id AND d.user_id = ?)"
          : "";
      const doctorParams = role === "doctor" ? [req.session.userId] : [];

      const [[{ appointments_today }]] = await pool.execute(
        `SELECT COUNT(*) AS appointments_today
         FROM appointments
         WHERE appointment_date = CURDATE()
           AND appointment_status != 'cancelled'${doctorFilter}`,
        doctorParams,
      );

      const [[{ pending_review }]] = await pool.execute(
        `SELECT COUNT(*) AS pending_review
         FROM appointments
         WHERE appointment_status = 'scheduled'${doctorFilter}`,
        doctorParams,
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
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

    try {
      await markOverdueAppointments();
      const role = normalizeRole(req.session.role);
      const doctorWhere = role === "doctor" ? " AND d.user_id = ?" : "";
      const doctorParams = role === "doctor" ? [req.session.userId] : [];
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
           ${doctorWhere}
         ORDER BY a.appointment_time ASC`,
        doctorParams,
      );

      return res.json(rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
    }
  });
}

module.exports = { registerAppointmentRoutes };
