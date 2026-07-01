CREATE DATABASE IF NOT EXISTS purple_point;
USE purple_point;

CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    contact_number VARCHAR(15) NOT NULL,
    role ENUM('patient', 'admin') DEFAULT 'patient',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS patients (
  patient_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender ENUM('male', 'female') NOT NULL,
  contact_number VARCHAR(20) NOT NULL,
  house_no VARCHAR(20) NOT NULL,
  street VARCHAR(50) NOT NULL,
  barangay VARCHAR(50) NOT NULL,
  city VARCHAR(100) NOT NULL,
  zip_code VARCHAR(10) NOT NULL,
  blood_type ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE IF NOT EXISTS appointments (
  appointment_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  appointment_type ENUM('consultation', 'cleaning', 'filling', 'extraction', 'other') NOT NULL,
  appointment_status ENUM('scheduled', 'confirmed', 'pending', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
  reason_for_visit TEXT,
  cancel_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
);

CREATE TABLE IF NOT EXISTS dental_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  visit_date DATE NOT NULL,
  dentist VARCHAR(100),
  diagnosis TEXT,
  treatment TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS staff (
  staff_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender ENUM('male', 'female') NOT NULL,
  contact_number VARCHAR(20) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  shift_schedule VARCHAR(100) NOT NULL,
  hire_date DATE NOT NULL,
  employment_status ENUM('Active', 'On-leave', 'Terminated') NOT NULL DEFAULT 'Active',
  -- FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dentist (
  dentist_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  date_of_birth DATE NOT NULL,
  gender ENUM('male', 'female') NOT NULL,
  contact_number VARCHAR(20) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  specialization VARCHAR(20) NOT NULL,
  license_number INT NOT NULL
  -- FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dentist_schedule (
  schedule_id INT AUTO_INCREMENT PRIMARY KEY,
  dentist_id INT NOT NULL,
  day_of_week ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  -- effective_from DATE NOT NULL,
  -- effective_to DATE NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (dentist_id) REFERENCES dentist(dentist_id)
);