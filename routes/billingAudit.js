"use strict";

const { pool } = require("../lib/database");
const {
  INTERNAL_ERROR_MESSAGE,
  requireField,
  requireRole,
} = require("../lib/http");
const {
  BILLING_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  calculatePaymentOutcome,
  isIsoDate,
  resolveBillingStatus,
} = require("../lib/businessRules");
const { createAuditLog, recordAudit } = require("../lib/audit");

function registerBillingAuditRoutes(app) {
  app.get("/api/audit-logs", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;

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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/audit-logs/:id", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "doctor", "staff"])) return;
    const auditLogId = Number.parseInt(req.params.id, 10);
    if (!auditLogId) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid audit log ID." });
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
        return res
          .status(404)
          .json({ ok: false, error: "Audit log not found." });
      }
      return res.json({ ok: true, log: rows[0] });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/billings", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "staff"])) return;

    const q = requireField(req.query, "q") || "";
    const status = (requireField(req.query, "status") || "").toLowerCase();
    if (status && !BILLING_STATUSES.includes(status)) {
      return res
        .status(400)
        .json({ ok: false, error: "Invalid billing status." });
    }

    try {
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/billing/patients/:patientId/treatments", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "staff"])) return;

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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.post("/api/billings", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "staff"])) return;

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
        return res
          .status(404)
          .json({ ok: false, error: "Treatment not found." });
      }

      const effectiveBillingStatus = resolveBillingStatus(
        totalAmount,
        0,
        billingStatus,
      );
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.get("/api/billings/:id", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "staff"])) return;

    const billingId = Number.parseInt(req.params.id, 10);
    if (!billingId) {
      return res.status(400).json({ ok: false, error: "Invalid billing ID." });
    }

    try {
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    }
  });

  app.patch("/api/billings/:id", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "staff"])) return;

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

      const effectiveBillingStatus = resolveBillingStatus(
        totalAmount,
        paymentTotal.amount_paid,
        billingStatus,
      );
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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
    }
  });

  app.post("/api/billings/:id/payments", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "staff"])) return;

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
        .json({
          ok: false,
          error: "Payment amount must be greater than zero.",
        });
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
        .json({
          ok: false,
          error: "Please select the billing status manually.",
        });
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
      const paymentOutcome = calculatePaymentOutcome({
        currentCompletedAmount: paymentTotal.amount_paid,
        paymentAmount: amountPaid,
        paymentStatus,
        totalAmount: billingRows[0].total_amount,
        manualBillingStatus: billingStatus,
      });
      if (paymentOutcome.exceedsTotal) {
        await conn.rollback();
        return res.status(400).json({
          ok: false,
          error: "Completed payment cannot exceed the remaining balance.",
        });
      }
      const newPaidTotal = paymentOutcome.completedAmount;
      const effectiveBillingStatus = paymentOutcome.billingStatus;

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
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
    }
  });

  app.patch("/api/payments/:id/status", async (req, res) => {
    if (!requireRole(req, res, ["superadmin", "staff"])) return;

    const paymentId = Number.parseInt(req.params.id, 10);
    const paymentStatus = (
      requireField(req.body, "payment_status") || ""
    ).toLowerCase();
    const billingStatus = (
      requireField(req.body, "billing_status") || ""
    ).toLowerCase();

    if (!paymentId) {
      return res.status(400).json({ ok: false, error: "Invalid payment ID." });
    }
    if (!["completed", "failed"].includes(paymentStatus)) {
      return res.status(400).json({
        ok: false,
        error: "A pending payment can only be completed or failed.",
      });
    }
    if (!BILLING_STATUSES.includes(billingStatus)) {
      return res.status(400).json({
        ok: false,
        error: "Please select the billing status after the payment update.",
      });
    }

    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [paymentLookup] = await conn.execute(
        "SELECT billing_id FROM payments WHERE payment_id = ?",
        [paymentId],
      );
      if (!paymentLookup.length) {
        await conn.rollback();
        return res.status(404).json({ ok: false, error: "Payment not found." });
      }
      const billingId = paymentLookup[0].billing_id;

      const [billingRows] = await conn.execute(
        `SELECT total_amount, billing_status
         FROM billing
         WHERE billing_id = ?
         FOR UPDATE`,
        [billingId],
      );
      if (!billingRows.length) {
        await conn.rollback();
        return res
          .status(404)
          .json({ ok: false, error: "Billing statement not found." });
      }

      const [paymentRows] = await conn.execute(
        `SELECT billing_id, amount_paid, payment_status, reference_number
         FROM payments
         WHERE payment_id = ? AND billing_id = ?
         FOR UPDATE`,
        [paymentId, billingId],
      );
      if (!paymentRows.length) {
        await conn.rollback();
        return res.status(404).json({ ok: false, error: "Payment not found." });
      }
      const payment = paymentRows[0];
      if (payment.payment_status !== "pending") {
        await conn.rollback();
        return res.status(409).json({
          ok: false,
          error: "Only pending payments can have their status updated.",
        });
      }

      const [[paymentTotal]] = await conn.execute(
        `SELECT COALESCE(SUM(amount_paid), 0) AS amount_paid
         FROM payments
         WHERE billing_id = ? AND payment_status = 'completed'`,
        [billingId],
      );
      const totalAmount = Number(billingRows[0].total_amount);
      const paymentOutcome = calculatePaymentOutcome({
        currentCompletedAmount: paymentTotal.amount_paid,
        paymentAmount: payment.amount_paid,
        paymentStatus,
        totalAmount,
        manualBillingStatus: billingStatus,
      });
      if (paymentOutcome.exceedsTotal) {
        await conn.rollback();
        return res.status(400).json({
          ok: false,
          error: "Completing this payment would exceed the remaining balance.",
        });
      }

      const newPaidTotal = paymentOutcome.completedAmount;
      const effectiveBillingStatus = paymentOutcome.billingStatus;
      await conn.execute(
        "UPDATE payments SET payment_status = ? WHERE payment_id = ?",
        [paymentStatus, paymentId],
      );
      await conn.execute(
        "UPDATE billing SET billing_status = ? WHERE billing_id = ?",
        [effectiveBillingStatus, billingId],
      );
      await createAuditLog(conn, req, {
        action: "UPDATE_PAYMENT_STATUS",
        entityType: "payment",
        entityId: paymentId,
        description: `Changed payment ${payment.reference_number || `#${paymentId}`} status from pending to ${paymentStatus}`,
        oldValues: {
          billing_id: billingId,
          payment_status: payment.payment_status,
          billing_status: billingRows[0].billing_status,
        },
        newValues: {
          billing_id: billingId,
          payment_status: paymentStatus,
          billing_status: effectiveBillingStatus,
        },
      });
      await conn.commit();

      return res.json({
        ok: true,
        message: "Payment status updated.",
        payment_status: paymentStatus,
        billing_status: effectiveBillingStatus,
        amount_paid: newPaidTotal,
        balance: paymentOutcome.balance,
      });
    } catch (err) {
      if (conn) await conn.rollback();
      console.error(err);
      return res.status(500).json({ ok: false, error: INTERNAL_ERROR_MESSAGE });
    } finally {
      if (conn) conn.release();
    }
  });
}

module.exports = { registerBillingAuditRoutes };
