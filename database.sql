CREATE TABLE users (
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

CREATE TABLE patients (
  patient_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNIQUE,
  date_of_birth DATE NOT NULL,
  gender ENUM('male', 'female') NOT NULL,
  house_no VARCHAR(20) NOT NULL,
  street VARCHAR(50) NOT NULL,
  barangay VARCHAR(50) NOT NULL,
  city VARCHAR(100) NOT NULL,
  zip_code VARCHAR(10) NOT NULL,
  blood_type ENUM('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-') NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE staff (
  staff_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  date_of_birth DATE NOT NULL,
  gender ENUM('male', 'female') NOT NULL,
  shift_schedule VARCHAR(100) NOT NULL,
  hire_date DATE NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE dentist (
  dentist_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  date_of_birth DATE NOT NULL,
  gender ENUM('male', 'female') NOT NULL,
  specialization VARCHAR(100) NOT NULL,
  license_number VARCHAR(50) NOT NULL,
  hire_date DATE,
  UNIQUE KEY uq_dentist_license_number (license_number),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE dentist_schedule (
  schedule_id INT AUTO_INCREMENT PRIMARY KEY,
  dentist_id INT NOT NULL,
  day_of_week ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (dentist_id) REFERENCES dentist(dentist_id)
);

CREATE TABLE appointments (
  appointment_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  dentist_id INT NOT NULL,
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  appointment_type ENUM('consultation', 'cleaning', 'filling', 'extraction', 'other') NOT NULL,
  appointment_status ENUM('scheduled', 'completed', 'cancelled') NOT NULL DEFAULT 'scheduled',
  reason_for_visit TEXT,
  cancel_reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
  FOREIGN KEY (dentist_id) REFERENCES dentist(dentist_id)
);

CREATE TABLE dental_records (
  dental_record_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  appointment_id INT,
  dentist_id INT,
  recorded_by INT NOT NULL,
  visit_date DATE NOT NULL,
  teeth_involved VARCHAR(255),
  treatment_plan_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_dental_records_appointment_id (appointment_id),
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
  FOREIGN KEY (appointment_id) REFERENCES appointments(appointment_id),
  FOREIGN KEY (dentist_id) REFERENCES dentist(dentist_id),
  FOREIGN KEY (recorded_by) REFERENCES users(user_id)
);

CREATE TABLE patient_records (
  patient_records_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL UNIQUE,
  date_registered DATE NOT NULL DEFAULT (CURRENT_DATE),
  emergency_contact_name VARCHAR(150) NOT NULL,
  emergency_contact_number VARCHAR(20) NOT NULL,
  patient_status ENUM('active', 'inactive', 'archived') NOT NULL DEFAULT 'active',
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

CREATE TABLE patient_vitals (
  patient_vitals_id INT AUTO_INCREMENT PRIMARY KEY,
  dental_record_id INT NOT NULL,
  staff_id INT NOT NULL,
  blood_pressure VARCHAR(20),
  heart_rate INT,
  temperature DECIMAL(4,1),
  weight DECIMAL(5,2),
  date_recorded DATE NOT NULL,
  FOREIGN KEY (dental_record_id) REFERENCES dental_records(dental_record_id) ON DELETE CASCADE,
  FOREIGN KEY (staff_id) REFERENCES users(user_id)
);

CREATE TABLE tooth_chart (
  tooth_chart_id INT AUTO_INCREMENT PRIMARY KEY,
  dental_record_id INT NOT NULL,
  tooth_number VARCHAR(10) NOT NULL,
  surface VARCHAR(20),
  condition_status VARCHAR(100),
  recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dental_record_id) REFERENCES dental_records(dental_record_id) ON DELETE CASCADE
);

CREATE TABLE treatment (
  treatment_id INT AUTO_INCREMENT PRIMARY KEY,
  treatment_name VARCHAR(150) NOT NULL,
  description TEXT,
  default_duration INT COMMENT 'minutes',
  default_price DECIMAL(10,2) NOT NULL,
  category VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE patient_treatments (
  patient_treatment_id INT AUTO_INCREMENT PRIMARY KEY,
  dental_record_id INT NOT NULL,
  treatment_id INT NOT NULL,
  teeth_involved VARCHAR(255),
  actual_price DECIMAL(10,2) NOT NULL,
  actual_duration INT COMMENT 'minutes',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (dental_record_id) REFERENCES dental_records(dental_record_id) ON DELETE CASCADE,
  FOREIGN KEY (treatment_id) REFERENCES treatment(treatment_id)
);

CREATE TABLE billing (
  billing_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  patient_treatment_id INT NOT NULL,
  billing_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  total_amount DECIMAL(10,2) NOT NULL,
  billing_status ENUM('unpaid', 'partial', 'paid') NOT NULL DEFAULT 'unpaid',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_billing_total_amount CHECK (total_amount >= 0),
  KEY patient_id (patient_id),
  KEY patient_treatment_id (patient_treatment_id),
  UNIQUE KEY uq_billing_patient_treatment (patient_treatment_id),
  CONSTRAINT billing_ibfk_1 FOREIGN KEY (patient_id) REFERENCES patients(patient_id),
  CONSTRAINT billing_ibfk_2 FOREIGN KEY (patient_treatment_id) REFERENCES patient_treatments(patient_treatment_id)
);

CREATE TABLE payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  billing_id INT NOT NULL,
  payment_date DATE NOT NULL DEFAULT (CURRENT_DATE),
  amount_paid DECIMAL(10,2) NOT NULL,
  payment_method ENUM('cash', 'card', 'gcash', 'bank_transfer', 'other') NOT NULL,
  payment_status ENUM('pending', 'completed', 'failed') NOT NULL DEFAULT 'completed',
  reference_number VARCHAR(30) UNIQUE,
  external_reference VARCHAR(100),
  notes VARCHAR(255),
  recorded_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_payment_amount CHECK (amount_paid > 0),
  FOREIGN KEY (billing_id) REFERENCES billing(billing_id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(user_id)
);

CREATE TABLE audit_logs (
  audit_log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT,
  actor_name_snapshot VARCHAR(150) NOT NULL,
  actor_type_snapshot VARCHAR(30) NOT NULL,
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INT,
  description VARCHAR(255) NOT NULL,
  old_values LONGTEXT,
  new_values LONGTEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_audit_old_values_json
    CHECK (old_values IS NULL OR JSON_VALID(old_values)),
  CONSTRAINT chk_audit_new_values_json
    CHECK (new_values IS NULL OR JSON_VALID(new_values)),
  KEY idx_audit_created_at (created_at),
  KEY idx_audit_actor (actor_user_id),
  KEY idx_audit_action (action),
  KEY idx_audit_entity (entity_type, entity_id),
  CONSTRAINT fk_audit_actor
    FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);
