-- Stage 2: fees, payments, receipts, Zoom matching, parent report records.
-- Money is stored as integer minor units (fils for AED, 1/1000 for KWD, whole yen for JPY ...).

CREATE TABLE fee_rates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  subject_id INT UNSIGNED NOT NULL,
  batch_id INT UNSIGNED NOT NULL DEFAULT 0,      -- 0 = every batch
  student_id INT UNSIGNED NOT NULL DEFAULT 0,    -- 0 = every student
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL,
  UNIQUE KEY uq_rate (subject_id, batch_id, student_id, currency),
  CONSTRAINT fk_rate_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB;

CREATE TABLE charges (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NULL,
  period CHAR(7) NULL,
  description VARCHAR(200) NOT NULL,
  currency CHAR(3) NOT NULL,
  amount_minor BIGINT NOT NULL,
  due_date DATE NOT NULL,
  voided TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(300) NOT NULL DEFAULT '',
  created_by INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_charges_student (student_id, due_date),
  KEY ix_charges_period (period, subject_id),
  CONSTRAINT fk_charge_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_charge_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB;

CREATE TABLE receipt_counters (
  year SMALLINT UNSIGNED PRIMARY KEY,
  n INT UNSIGNED NOT NULL
) ENGINE=InnoDB;

CREATE TABLE payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_no VARCHAR(30) NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,            -- what the payment is worth against the student's fees
  amount_minor BIGINT NOT NULL,
  paid_currency CHAR(3) NOT NULL,       -- what the family actually handed over
  paid_minor BIGINT NOT NULL,
  rate DECIMAL(18,8) NOT NULL DEFAULT 1,
  method ENUM('cash','bank_transfer','card','online','cheque','other') NOT NULL,
  reference VARCHAR(120) NOT NULL DEFAULT '',
  note VARCHAR(300) NOT NULL DEFAULT '',
  paid_at DATETIME(3) NOT NULL,
  received_by INT UNSIGNED NULL,
  voided TINYINT(1) NOT NULL DEFAULT 0,
  void_reason VARCHAR(300) NOT NULL DEFAULT '',
  voided_by INT UNSIGNED NULL,
  voided_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_receipt (receipt_no),
  KEY ix_payments_student (student_id, paid_at),
  KEY ix_payments_paid_at (paid_at),
  CONSTRAINT fk_pay_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

CREATE TABLE attendance_unmatched (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id INT UNSIGNED NOT NULL,
  name VARCHAR(190) NOT NULL,
  email VARCHAR(190) NOT NULL DEFAULT '',
  duration_sec INT UNSIGNED NOT NULL DEFAULT 0,
  KEY ix_unmatched_class (class_id),
  CONSTRAINT fk_unm_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE parent_report_sends (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  student_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  month CHAR(7) NOT NULL,
  channel ENUM('whatsapp','email') NOT NULL,
  recipient VARCHAR(190) NOT NULL,
  mode ENUM('auto','manual') NOT NULL DEFAULT 'manual',   -- 'manual' = staff sent it themselves and recorded it
  status ENUM('queued','sent','delivered','failed','recorded') NOT NULL DEFAULT 'recorded',
  error VARCHAR(400) NULL,
  report_hash CHAR(20) NOT NULL,
  summary JSON NULL,
  sent_by INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_prs_lookup (student_id, subject_id, month),
  CONSTRAINT fk_prs_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

ALTER TABLE classes ADD COLUMN zoom_synced_at DATETIME(3) NULL;
