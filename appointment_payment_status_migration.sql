ALTER TABLE appointments
  MODIFY appointment_status
    ENUM('scheduled', 'completed', 'cancelled', 'no_show')
    NOT NULL DEFAULT 'scheduled';

ALTER TABLE payments
  MODIFY payment_method
    ENUM('cash', 'card', 'gcash', 'e_wallet', 'bank_transfer', 'other')
    NOT NULL;

UPDATE appointments
SET appointment_status = 'no_show'
WHERE appointment_status = 'scheduled'
  AND appointment_date < CURDATE();
