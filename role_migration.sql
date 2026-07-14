-- Apply this once to an existing PurplePoint database.
-- The earliest legacy admin remains the superadmin. Other legacy admin
-- accounts with doctor/staff profiles receive their matching limited role.
ALTER TABLE users
  MODIFY role ENUM('patient', 'admin', 'superadmin', 'doctor', 'staff')
  NOT NULL DEFAULT 'patient';

SET @superadmin_user_id := (
  SELECT MIN(user_id) FROM users WHERE role = 'admin'
);

UPDATE users SET role = 'superadmin' WHERE role = 'admin';

UPDATE users u
JOIN dentist d ON d.user_id = u.user_id
SET u.role = 'doctor'
WHERE u.user_id <> COALESCE(@superadmin_user_id, 0)
  AND u.role IN ('patient', 'superadmin');

UPDATE users u
JOIN staff s ON s.user_id = u.user_id
SET u.role = 'staff'
WHERE u.user_id <> COALESCE(@superadmin_user_id, 0)
  AND u.role IN ('patient', 'superadmin');

ALTER TABLE users
  MODIFY role ENUM('patient', 'superadmin', 'doctor', 'staff')
  NOT NULL DEFAULT 'patient';
