"use strict";

const { pool } = require("../lib/database");
const { createAuditLog } = require("../lib/audit");
const {
  INTERNAL_ERROR_MESSAGE,
  requireField,
  requireRole,
} = require("../lib/http");
const { isIsoDate, parsePositiveInteger } = require("../lib/businessRules");

const ARCHIVE_REASON_MIN_LENGTH = 3;
const ARCHIVE_REASON_MAX_LENGTH = 255;

function registerArchiveRoutes(app) {
  app.get("/api/archives/patients", async (req, res) => {
    if (!requireRole(req, res, ["superadmin"])) return;

    const search = requireField(req.query, "search") || "";
    const dateFrom = requireField(req.query, "date_from") || "";
    const dateTo = requireField(req.query, "date_to") || "";
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(req.query.limit, 10) || 8),
    );
    if (
      (dateFrom && !isIsoDate(dateFrom)) ||
      (dateTo && !isIsoDate(dateTo)) ||
      (dateFrom && dateTo && dateFrom > dateTo)
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid archive date filter." });
    }

    const where = ["pr.patient_status = 'archived'"];
    const params = [];
    if (search) {
      const term = `%${search}%`;
      where.push(`(
        CAST(p.patient_id AS CHAR) LIKE ?
        OR CONCAT(
          'P-',
          CASE
            WHEN p.patient_id < 1000 THEN LPAD(p.patient_id, 3, '0')
            ELSE CAST(p.patient_id AS CHAR)
          END
        ) LIKE ?
        OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?
        OR u.email LIKE ?
        OR u.contact_number LIKE ?
        OR pr.archive_reason LIKE ?
      )`);
      params.push(term, term, term, term, term, term);
    }
    if (dateFrom) {
      where.push("pr.archived_at >= ?");
      params.push(`${dateFrom} 00:00:00`);
    }
    if (dateTo) {
      where.push("pr.archived_at < DATE_ADD(?, INTERVAL 1 DAY)");
      params.push(`${dateTo} 00:00:00`);
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;
    const offset = (page - 1) * limit;

    try {
      const [[countRow]] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM patients p
         JOIN users u ON u.user_id = p.user_id
         JOIN patient_records pr ON pr.patient_id = p.patient_id
         ${whereSql}`,
        params,
      );
      const [patients] = await pool.execute(
        `SELECT
           p.patient_id,
           CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
           u.email,
           u.contact_number,
           COALESCE(pr.status_before_archive, 'inactive') AS status_before_archive,
           DATE_FORMAT(pr.archived_at, '%Y-%m-%d %H:%i:%s') AS archived_at,
           pr.archive_reason,
           COALESCE(
             CONCAT(au.first_name, ' ', au.last_name),
             'Unknown user'
           ) AS archived_by_name,
           (SELECT COUNT(*) FROM appointments a
             WHERE a.patient_id = p.patient_id) AS appointment_count,
           (SELECT COUNT(*) FROM dental_records dr
             WHERE dr.patient_id = p.patient_id) AS dental_record_count,
           (SELECT COUNT(*) FROM billing b
             WHERE b.patient_id = p.patient_id) AS billing_count
         FROM patients p
         JOIN users u ON u.user_id = p.user_id
         JOIN patient_records pr ON pr.patient_id = p.patient_id
         LEFT JOIN users au ON au.user_id = pr.archived_by
         ${whereSql}
         ORDER BY pr.archived_at DESC, p.patient_id DESC
         LIMIT ${limit} OFFSET ${offset}`,
        params,
      );
      const total = Number(countRow.total);
      return res.json({
        ok: true,
        patients,
        pagination: {
          page,
          limit,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.patch("/api/patients/:id/archive", async (req, res) => {
    if (!requireRole(req, res, ["superadmin"])) return;

    const patientId = parsePositiveInteger(req.params.id);
    const reason = requireField(req.body || {}, "reason") || "";
    if (!patientId) {
      return res.status(400).json({ ok: false, error: "Invalid patient ID." });
    }
    if (
      reason.length < ARCHIVE_REASON_MIN_LENGTH ||
      reason.length > ARCHIVE_REASON_MAX_LENGTH
    ) {
      return res.status(400).json({
        ok: false,
        error: `Archive reason must contain ${ARCHIVE_REASON_MIN_LENGTH} to ${ARCHIVE_REASON_MAX_LENGTH} characters.`,
      });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT p.patient_id, pr.patient_records_id, pr.patient_status,
                CONCAT(u.first_name, ' ', u.last_name) AS patient_name
         FROM patients p
         JOIN users u ON u.user_id = p.user_id
         LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
         WHERE p.patient_id = ?
         FOR UPDATE`,
        [patientId],
      );
      if (!rows.length) {
        await conn.rollback();
        return res.status(404).json({ ok: false, error: "Patient not found." });
      }
      const patient = rows[0];
      if (!patient.patient_records_id) {
        await conn.rollback();
        return res.status(409).json({
          ok: false,
          error: "The patient must complete their profile before being archived.",
        });
      }
      if (patient.patient_status === "archived") {
        await conn.rollback();
        return res
          .status(409)
          .json({ ok: false, error: "Patient is already archived." });
      }

      const [[upcomingRow]] = await conn.execute(
        `SELECT COUNT(*) AS total
         FROM appointments
         WHERE patient_id = ?
           AND appointment_status = 'scheduled'
           AND TIMESTAMP(appointment_date, appointment_time) >= NOW()`,
        [patientId],
      );
      const upcomingAppointments = Number(upcomingRow.total);
      if (upcomingAppointments > 0) {
        await conn.rollback();
        return res.status(409).json({
          ok: false,
          error: `This patient has ${upcomingAppointments} upcoming scheduled ${upcomingAppointments === 1 ? "appointment" : "appointments"}. Complete or cancel them before archiving.`,
          upcoming_appointments: upcomingAppointments,
        });
      }

      await conn.execute(
        `UPDATE patient_records
         SET status_before_archive = ?,
             patient_status = 'archived',
             archived_at = NOW(),
             archived_by = ?,
             archive_reason = ?
         WHERE patient_id = ?`,
        [patient.patient_status, req.session.userId, reason, patientId],
      );
      await createAuditLog(conn, req, {
        action: "ARCHIVE_PATIENT",
        entityType: "patient",
        entityId: patientId,
        description: `Archived ${patient.patient_name}`,
        oldValues: { patient_status: patient.patient_status },
        newValues: {
          patient_status: "archived",
          archive_reason: reason,
        },
      });
      await conn.commit();
      return res.json({
        ok: true,
        message: `${patient.patient_name} was archived successfully.`,
      });
    } catch (error) {
      if (conn) await conn.rollback();
      console.error(error);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
    }
  });

  app.patch("/api/patients/:id/restore", async (req, res) => {
    if (!requireRole(req, res, ["superadmin"])) return;

    const patientId = parsePositiveInteger(req.params.id);
    if (!patientId) {
      return res.status(400).json({ ok: false, error: "Invalid patient ID." });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT p.patient_id, pr.patient_records_id, pr.patient_status,
                pr.status_before_archive, pr.archive_reason,
                CONCAT(u.first_name, ' ', u.last_name) AS patient_name
         FROM patients p
         JOIN users u ON u.user_id = p.user_id
         LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
         WHERE p.patient_id = ?
         FOR UPDATE`,
        [patientId],
      );
      if (!rows.length) {
        await conn.rollback();
        return res.status(404).json({ ok: false, error: "Patient not found." });
      }
      const patient = rows[0];
      if (!patient.patient_records_id || patient.patient_status !== "archived") {
        await conn.rollback();
        return res
          .status(409)
          .json({ ok: false, error: "Patient is not archived." });
      }
      const restoredStatus = ["active", "inactive"].includes(
        patient.status_before_archive,
      )
        ? patient.status_before_archive
        : "inactive";

      await conn.execute(
        `UPDATE patient_records
         SET patient_status = ?,
             status_before_archive = NULL,
             archived_at = NULL,
             archived_by = NULL,
             archive_reason = NULL
         WHERE patient_id = ?`,
        [restoredStatus, patientId],
      );
      await createAuditLog(conn, req, {
        action: "RESTORE_PATIENT",
        entityType: "patient",
        entityId: patientId,
        description: `Restored ${patient.patient_name}`,
        oldValues: {
          patient_status: "archived",
          archive_reason: patient.archive_reason,
        },
        newValues: { patient_status: restoredStatus },
      });
      await conn.commit();
      return res.json({
        ok: true,
        message: `${patient.patient_name} was restored as ${restoredStatus}.`,
        patient_status: restoredStatus,
      });
    } catch (error) {
      if (conn) await conn.rollback();
      console.error(error);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
    }
  });
}

module.exports = { registerArchiveRoutes };
