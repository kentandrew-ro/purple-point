-- Apply this once to an existing PurplePoint database before running the
-- application version that stores diabetes and allergy information.

CREATE TABLE IF NOT EXISTS patient_medical_profiles (
  patient_id INT PRIMARY KEY,
  diabetes_status ENUM('unknown', 'no', 'yes') NOT NULL DEFAULT 'unknown',
  medical_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS patient_allergies (
  patient_allergy_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  allergen VARCHAR(150) NOT NULL,
  reaction VARCHAR(255),
  severity ENUM('mild', 'moderate', 'severe'),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_patient_allergy (patient_id, allergen),
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

INSERT INTO patient_medical_profiles (patient_id, diabetes_status)
SELECT patient_id, 'unknown'
FROM patients
ON DUPLICATE KEY UPDATE patient_id = VALUES(patient_id);

ALTER TABLE patient_vitals DROP COLUMN weight;
