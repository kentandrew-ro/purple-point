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
  email VARCHAR(150) UNIQUE NOT NULL,
  house_no VARCHAR(20) NOT NULL,
  street VARCHAR(50) NOT NULL,
  barangay VARCHAR(50) NOT NULL,
  city VARCHAR(100) NOT NULL,
  zip_code VARCHAR(10) NOT NULL,
  blood_type ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);