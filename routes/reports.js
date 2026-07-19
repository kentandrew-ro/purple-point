"use strict";

const { pool } = require("../lib/database");
const {
  INTERNAL_ERROR_MESSAGE,
  normalizeRole,
  requireField,
  requireRole,
} = require("../lib/http");
const {
  APPOINTMENT_TYPES,
  BILLING_STATUSES,
  isIsoDate,
  parsePositiveInteger,
} = require("../lib/businessRules");

const APPOINTMENT_STATUSES = Object.freeze([
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
]);
const PATIENT_STATUSES = Object.freeze(["active", "inactive", "archived"]);
const REPORT_PAGE_SIZE = 10;

function readPagination(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(
    50,
    Math.max(1, Number.parseInt(query.limit, 10) || REPORT_PAGE_SIZE),
  );
  return { page, limit, offset: (page - 1) * limit };
}

function readDateRange(req, res) {
  const dateFrom = requireField(req.query, "date_from") || "";
  const dateTo = requireField(req.query, "date_to") || "";
  if (
    (dateFrom && !isIsoDate(dateFrom)) ||
    (dateTo && !isIsoDate(dateTo)) ||
    (dateFrom && dateTo && dateFrom > dateTo)
  ) {
    res.status(400).json({ ok: false, error: "Invalid report date range." });
    return null;
  }
  return { dateFrom, dateTo };
}

function addDateRange(where, params, column, range) {
  if (range.dateFrom) {
    where.push(`${column} >= ?`);
    params.push(range.dateFrom);
  }
  if (range.dateTo) {
    where.push(`${column} <= ?`);
    params.push(range.dateTo);
  }
}

function readDentistId(req, res) {
  const rawDentistId = requireField(req.query, "dentist_id") || "";
  const dentistId = rawDentistId ? parsePositiveInteger(rawDentistId) : null;
  if (rawDentistId && !dentistId) {
    res.status(400).json({ ok: false, error: "Invalid doctor filter." });
    return false;
  }
  return dentistId;
}

async function executePagedReport({ countSql, dataSql, params, pagination }) {
  const [[countRow]] = await pool.execute(countSql, params);
  const total = Number(countRow.total);
  const [rows] = await pool.execute(
    `${dataSql}\nLIMIT ${pagination.limit} OFFSET ${pagination.offset}`,
    params,
  );
  return {
    rows,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      pages: Math.max(1, Math.ceil(total / pagination.limit)),
    },
  };
}

function registerReportRoutes(app) {
  app.get("/api/reports/appointments", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

    const range = readDateRange(req, res);
    if (!range) return;
    const dentistId = readDentistId(req, res);
    if (dentistId === false) return;
    const status = (requireField(req.query, "status") || "").toLowerCase();
    const appointmentType = (
      requireField(req.query, "appointment_type") || ""
    ).toLowerCase();
    if (status && !APPOINTMENT_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid appointment status filter." });
    }
    if (appointmentType && !APPOINTMENT_TYPES.includes(appointmentType)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid appointment type filter." });
    }

    const where = [];
    const params = [];
    addDateRange(where, params, "a.appointment_date", range);
    if (dentistId) {
      where.push("a.dentist_id = ?");
      params.push(dentistId);
    }
    if (status) {
      where.push("a.appointment_status = ?");
      params.push(status);
    }
    if (appointmentType) {
      where.push("a.appointment_type = ?");
      params.push(appointmentType);
    }
    if (normalizeRole(req.session.role) === "doctor") {
      where.push("du.user_id = ?");
      params.push(req.session.userId);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const pagination = readPagination(req.query);

    try {
      const result = await executePagedReport({
        countSql: `SELECT COUNT(*) AS total
                   FROM appointments a
                   JOIN dentist d ON d.dentist_id = a.dentist_id
                   JOIN users du ON du.user_id = d.user_id
                   ${whereSql}`,
        dataSql: `SELECT
                    a.appointment_id,
                    DATE_FORMAT(a.appointment_date, '%Y-%m-%d') AS appointment_date,
                    DATE_FORMAT(a.appointment_time, '%h:%i %p') AS appointment_time,
                    CONCAT(pu.first_name, ' ', pu.last_name) AS patient_name,
                    CONCAT('Dr. ', du.first_name, ' ', du.last_name) AS doctor_name,
                    a.appointment_type,
                    COALESCE(
                      NULLIF((
                        SELECT GROUP_CONCAT(DISTINCT t.treatment_name
                          ORDER BY t.treatment_name SEPARATOR ', ')
                        FROM dental_records dr
                        JOIN patient_treatments pt
                          ON pt.dental_record_id = dr.dental_record_id
                        JOIN treatment t ON t.treatment_id = pt.treatment_id
                        WHERE dr.appointment_id = a.appointment_id
                      ), ''),
                      'Not recorded'
                    ) AS service_availed,
                    a.appointment_status,
                    COALESCE(NULLIF(a.reason_for_visit, ''), '—') AS reason_for_visit
                  FROM appointments a
                  JOIN patients p ON p.patient_id = a.patient_id
                  JOIN users pu ON pu.user_id = p.user_id
                  JOIN dentist d ON d.dentist_id = a.dentist_id
                  JOIN users du ON du.user_id = d.user_id
                  ${whereSql}
                  ORDER BY a.appointment_date ASC, a.appointment_time ASC,
                           pu.last_name ASC, pu.first_name ASC`,
        params,
        pagination,
      });
      return res.json({ ok: true, title: "Appointment Report", ...result });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/reports/patients", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

    const range = readDateRange(req, res);
    if (!range) return;
    const status = (requireField(req.query, "status") || "").toLowerCase();
    const gender = (requireField(req.query, "gender") || "").toLowerCase();
    if (status && !PATIENT_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid patient status filter." });
    }
    if (gender && !["male", "female"].includes(gender)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid patient sex filter." });
    }

    const where = [];
    const params = [];
    addDateRange(
      where,
      params,
      "COALESCE(pr.date_registered, DATE(p.created_at))",
      range,
    );
    if (status) {
      where.push("pr.patient_status = ?");
      params.push(status);
    }
    if (gender) {
      where.push("p.gender = ?");
      params.push(gender);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const pagination = readPagination(req.query);

    try {
      const result = await executePagedReport({
        countSql: `SELECT COUNT(*) AS total
                   FROM patients p
                   JOIN users u ON u.user_id = p.user_id
                   LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
                   ${whereSql}`,
        dataSql: `SELECT
                    p.patient_id,
                    CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                    u.email,
                    u.contact_number,
                    DATE_FORMAT(
                      COALESCE(pr.date_registered, DATE(p.created_at)),
                      '%Y-%m-%d'
                    ) AS date_registered,
                    COALESCE(pr.patient_status, 'Not set') AS patient_status,
                    COALESCE(
                      DATE_FORMAT(MAX(a.appointment_date), '%Y-%m-%d'),
                      'No appointments'
                    ) AS last_appointment,
                    COUNT(a.appointment_id) AS appointment_count
                  FROM patients p
                  JOIN users u ON u.user_id = p.user_id
                  LEFT JOIN patient_records pr ON pr.patient_id = p.patient_id
                  LEFT JOIN appointments a ON a.patient_id = p.patient_id
                  ${whereSql}
                  GROUP BY p.patient_id, u.first_name, u.last_name, u.email,
                           u.contact_number, p.created_at, pr.date_registered,
                           pr.patient_status
                  ORDER BY COALESCE(pr.date_registered, DATE(p.created_at)) ASC,
                           u.last_name ASC, u.first_name ASC`,
        params,
        pagination,
      });
      return res.json({ ok: true, title: "Patient Report", ...result });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/reports/treatments", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "doctor"])) return;

    const range = readDateRange(req, res);
    if (!range) return;
    const dentistId = readDentistId(req, res);
    if (dentistId === false) return;
    const category = requireField(req.query, "category") || "";

    const where = [];
    const params = [];
    addDateRange(where, params, "dr.visit_date", range);
    if (dentistId) {
      where.push("dr.dentist_id = ?");
      params.push(dentistId);
    }
    if (category) {
      where.push("t.category LIKE ?");
      params.push(`%${category}%`);
    }
    if (normalizeRole(req.session.role) === "doctor") {
      where.push("du.user_id = ?");
      params.push(req.session.userId);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const pagination = readPagination(req.query);

    try {
      const result = await executePagedReport({
        countSql: `SELECT COUNT(*) AS total
                   FROM patient_treatments pt
                   JOIN dental_records dr
                     ON dr.dental_record_id = pt.dental_record_id
                   JOIN treatment t ON t.treatment_id = pt.treatment_id
                   LEFT JOIN dentist d ON d.dentist_id = dr.dentist_id
                   LEFT JOIN users du ON du.user_id = d.user_id
                   ${whereSql}`,
        dataSql: `SELECT
                    pt.patient_treatment_id,
                    DATE_FORMAT(dr.visit_date, '%Y-%m-%d') AS visit_date,
                    CONCAT(pu.first_name, ' ', pu.last_name) AS patient_name,
                    COALESCE(
                      CONCAT('Dr. ', du.first_name, ' ', du.last_name),
                      'Not assigned'
                    ) AS doctor_name,
                    t.treatment_name,
                    COALESCE(NULLIF(t.category, ''), 'Uncategorized') AS category,
                    COALESCE(NULLIF(pt.teeth_involved, ''), '—') AS teeth_involved,
                    COALESCE(pt.actual_duration, 0) AS actual_duration,
                    pt.actual_price
                  FROM patient_treatments pt
                  JOIN dental_records dr
                    ON dr.dental_record_id = pt.dental_record_id
                  JOIN patients p ON p.patient_id = dr.patient_id
                  JOIN users pu ON pu.user_id = p.user_id
                  JOIN treatment t ON t.treatment_id = pt.treatment_id
                  LEFT JOIN dentist d ON d.dentist_id = dr.dentist_id
                  LEFT JOIN users du ON du.user_id = d.user_id
                  ${whereSql}
                  ORDER BY dr.visit_date ASC, pu.last_name ASC, pu.first_name ASC,
                           t.treatment_name ASC`,
        params,
        pagination,
      });
      return res.json({ ok: true, title: "Treatment Report", ...result });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/reports/billing", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "staff"])) return;

    const range = readDateRange(req, res);
    if (!range) return;
    const status = (requireField(req.query, "status") || "").toLowerCase();
    if (status && !BILLING_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid billing status filter." });
    }

    const where = [];
    const params = [];
    addDateRange(where, params, "b.billing_date", range);
    if (status) {
      where.push("b.billing_status = ?");
      params.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const pagination = readPagination(req.query);

    try {
      const result = await executePagedReport({
        countSql: `SELECT COUNT(*) AS total
                   FROM billing b
                   ${whereSql}`,
        dataSql: `SELECT
                    b.billing_id,
                    DATE_FORMAT(b.billing_date, '%Y-%m-%d') AS billing_date,
                    CONCAT(u.first_name, ' ', u.last_name) AS patient_name,
                    t.treatment_name,
                    b.total_amount,
                    COALESCE((
                      SELECT SUM(pay.amount_paid)
                      FROM payments pay
                      WHERE pay.billing_id = b.billing_id
                        AND pay.payment_status = 'completed'
                    ), 0) AS amount_paid,
                    GREATEST(
                      b.total_amount - COALESCE((
                        SELECT SUM(pay.amount_paid)
                        FROM payments pay
                        WHERE pay.billing_id = b.billing_id
                          AND pay.payment_status = 'completed'
                      ), 0),
                      0
                    ) AS balance,
                    b.billing_status
                  FROM billing b
                  JOIN patients p ON p.patient_id = b.patient_id
                  JOIN users u ON u.user_id = p.user_id
                  JOIN patient_treatments pt
                    ON pt.patient_treatment_id = b.patient_treatment_id
                  JOIN treatment t ON t.treatment_id = pt.treatment_id
                  ${whereSql}
                  ORDER BY b.billing_date ASC, b.billing_id ASC`,
        params,
        pagination,
      });
      return res.json({ ok: true, title: "Billing Report", ...result });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });
}

module.exports = { registerReportRoutes };
