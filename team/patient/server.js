const express = require('express');
const mysql = require('mysql2/promise');
const { spawn } = require('child_process');
const path = require('path');

const app = express();


app.use(express.json());

app.use(express.static(__dirname));
app.use('/appointment', express.static(path.join(__dirname, '..', 'appointment')));

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: '',
  database: 'dental_clinic',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: true,
});

function requireField(obj, key) {
  const v = obj?.[key];
  if (v === undefined || v === null) return null;
  return String(v).trim();
}

app.post('/api/patients', async (req, res) => {
  try {
    const body = req.body || {};

    const first_name = requireField(body, 'first_name') || requireField(body, 'firstName');
    const last_name = requireField(body, 'last_name') || requireField(body, 'lastName');
    const date_of_birth = requireField(body, 'date_of_birth') || requireField(body, 'dob');
    let gender = requireField(body, 'gender') || requireField(body, 'sex');
    const contact_number = requireField(body, 'contact_number') || requireField(body, 'contactNumber');
    const email = requireField(body, 'email');
    const house_no = requireField(body, 'house_no');
    const street = requireField(body, 'street');
    const barangay = requireField(body, 'barangay');
    const city = requireField(body, 'city');
    const zip_code = requireField(body, 'zip_code') || requireField(body, 'zip');

    let blood_type = requireField(body, 'blood_type');

    const missing = [];
    if (!first_name) missing.push('first_name');
    if (!last_name) missing.push('last_name');
    if (!date_of_birth) missing.push('date_of_birth');
    if (!gender) missing.push('gender');
    if (!contact_number) missing.push('contact_number');
    if (!email) missing.push('email');
    if (!house_no) missing.push('house_no');
    if (!street) missing.push('street');
    if (!barangay) missing.push('barangay');
    if (!city) missing.push('city');
    if (!zip_code) missing.push('zip_code');
    if (!blood_type) missing.push('blood_type');

    if (missing.length) {
      return res.status(400).json({
        ok: false,
        error: `Missing required field(s): ${missing.join(', ')}`
      });
    }

    const normalizedGender = (gender || '').toLowerCase();
    if (!['male', 'female'].includes(normalizedGender)) {
      return res.status(400).json({ ok: false, error: 'Invalid gender. Use Male or Female.' });
    }

    const [result] = await pool.execute(
      `INSERT INTO patients (
        first_name,
        last_name,
        date_of_birth,
        gender,
        contact_number,
        email,
        house_no,
        street,
        barangay,
        city,
        zip_code,
        blood_type
      ) VALUES (
        :first_name,
        :last_name,
        :date_of_birth,
        :gender,
        :contact_number,
        :email,
        :house_no,
        :street,
        :barangay,
        :city,
        :zip_code,
        :blood_type
      )`,
      {
        first_name,
        last_name,
        date_of_birth,
        gender: normalizedGender,
        contact_number,
        email,
        house_no,
        street,
        barangay,
        city,
        zip_code,
        blood_type
      }
    );

    return res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err?.message ? String(err.message) : 'Database error'
    });
  }
});

app.post('/api/appointments', async (req, res) => {
  try {
    const body = req.body || {};
    const patient_id = Number(requireField(body, 'patient_id'));
    const appointment_date = requireField(body, 'appointment_date');
    const appointment_time = requireField(body, 'appointment_time');
    const appointment_type = requireField(body, 'appointment_type');
    const appointment_status = requireField(body, 'status');
    const reason_for_visit = requireField(body, 'reason') || null;

    const missing = [];
    if (!patient_id || Number.isNaN(patient_id)) missing.push('patient_id');
    if (!appointment_date) missing.push('appointment_date');
    if (!appointment_time) missing.push('appointment_time');
    if (!appointment_type) missing.push('appointment_type');
    if (!appointment_status) missing.push('status');

    if (missing.length) {
      return res.status(400).json({ ok: false, error: `Missing required field(s): ${missing.join(', ')}` });
    }

    const validTypes = ['consultation', 'cleaning', 'filling', 'extraction', 'other'];
    if (!validTypes.includes(appointment_type)) {
      return res.status(400).json({ ok: false, error: `Invalid appointment type. Must be one of: ${validTypes.join(', ')}` });
    }

    const validStatuses = ['scheduled', 'completed', 'cancelled'];
    if (!validStatuses.includes(appointment_status)) {
      return res.status(400).json({ ok: false, error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const appointmentDateTime = `${appointment_date} ${appointment_time}`;

    const [patientRows] = await pool.execute('SELECT patient_id FROM patients WHERE patient_id = :id', { id: patient_id });
    if (!Array.isArray(patientRows) || !patientRows.length) {
      return res.status(400).json({ ok: false, error: `Patient with id ${patient_id} does not exist` });
    }

    const [result] = await pool.execute(
      `INSERT INTO appointments (
        patient_id,
        appointment_date,
        appointment_type,
        appointment_status,
        reason_for_visit
      ) VALUES (
        :patient_id,
        :appointment_date,
        :appointment_type,
        :appointment_status,
        :reason_for_visit
      )`,
      { patient_id, appointment_date: appointmentDateTime, appointment_type, appointment_status, reason_for_visit }
    );

    return res.json({ ok: true, id: result.insertId });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message ? String(err.message) : 'Database error' });
  }
});

app.get('/api/appointments', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT a.appointment_id as id, a.patient_id, a.appointment_date, a.appointment_type, a.appointment_status, a.reason_for_visit as reason,
              p.first_name, p.last_name
       FROM appointments a
       JOIN patients p ON p.patient_id = a.patient_id
       ORDER BY a.appointment_id DESC`
    );
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message ? String(err.message) : 'Database error' });
  }
});

app.post('/api/appointments/:id/cancel', async (req, res) => {
  try {
    const appointmentId = Number(req.params.id);
    const cancel_reason = requireField(req.body, 'cancel_reason');

    if (!appointmentId || Number.isNaN(appointmentId)) {
      return res.status(400).json({ ok: false, error: 'Invalid appointment id' });
    }
    if (!cancel_reason) {
      return res.status(400).json({ ok: false, error: 'cancel_reason is required' });
    }

    const [rows] = await pool.execute('SELECT appointment_status, cancel_reason FROM appointments WHERE appointment_id = :id', { id: appointmentId });
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(404).json({ ok: false, error: 'Appointment not found' });
    }
    if (rows[0].appointment_status === 'cancelled') {
      return res.status(400).json({ ok: false, error: 'Appointment is already cancelled' });
    }

    await pool.execute(
      'UPDATE appointments SET appointment_status = :status, cancel_reason = :cancel_reason, cancelled_at = NOW() WHERE appointment_id = :id',
      { status: 'cancelled', cancel_reason: cancel_reason, id: appointmentId }
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message ? String(err.message) : 'Database error' });
  }
});

async function ensureDbInitialized() {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'db_init.js');

    const child = spawn(process.execPath, [scriptPath], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`db_init.js exited with code ${code}`));
    });
  });
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

ensureDbInitialized()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Patient profile API listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });


