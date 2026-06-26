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

app.get("/patientPage.html", (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login.html");
  }
  if (req.session.role !== "patient") {
    return res.redirect("/adminPage.html");
  }
  res.sendFile(
    path.join(__dirname, "protected", "patient", "patientPage.html"),
  );
});

app.get("/adminPage.html", (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login.html");
  }
  if (req.session.role !== "admin") {
    return res.redirect("/patientPage.html");
  }
  res.sendFile(path.join(__dirname, "protected", "admin", "adminPage.html"));
});

app.get("/profile.html", (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/login.html");
  }
  if (req.session.role !== "patient") {
    return res.redirect("/adminPage.html");
  }
  res.sendFile(path.join(__dirname, "protected", "patient", "profile.html"));
});

app.get("/js/profile.js", (req, res) => {
  if (!req.session.userId) return res.status(401).send("Unauthorized");
  res.sendFile(path.join(__dirname, "protected", "js", "profile.js"));
});

app.listen(PORT, () => {});
