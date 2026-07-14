-- Apply this once to an existing PurplePoint database before running the
-- application version that reads from the emergency_contacts table.
-- Existing emergency-contact values are copied before the old columns are
-- removed from patient_records.

CREATE TABLE IF NOT EXISTS emergency_contacts (
  emergency_contact_id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL UNIQUE,
  contact_name VARCHAR(150) NOT NULL,
  contact_number VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

INSERT INTO emergency_contacts (patient_id, contact_name, contact_number)
SELECT patient_id, emergency_contact_name, emergency_contact_number
FROM patient_records
WHERE TRIM(emergency_contact_name) <> ''
  AND TRIM(emergency_contact_number) <> ''
ON DUPLICATE KEY UPDATE
  contact_name = VALUES(contact_name),
  contact_number = VALUES(contact_number);

ALTER TABLE patient_records
  DROP COLUMN emergency_contact_name,
  DROP COLUMN emergency_contact_number;
