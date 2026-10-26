-- Mannu's Tuition Academy: core schema (MySQL 8 / MariaDB 10.5+, utf8mb4)
-- All times are stored in UTC. Money (stage 2) is stored as integer minor units.

CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL,
  name VARCHAR(120) NOT NULL,
  role ENUM('admin','teacher','student') NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  phone VARCHAR(40) NOT NULL DEFAULT '',
  student_id INT UNSIGNED NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE subjects (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(80) NOT NULL,
  UNIQUE KEY uq_subjects_code (code),
  UNIQUE KEY uq_subjects_name (name)
) ENGINE=InnoDB;

CREATE TABLE batches (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_batches_name (name)
) ENGINE=InnoDB;

CREATE TABLE students (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  zoom_email VARCHAR(190) NOT NULL DEFAULT '',
  mobile VARCHAR(40) NOT NULL DEFAULT '',
  guardian_name VARCHAR(120) NOT NULL DEFAULT '',
  guardian_mobile VARCHAR(40) NOT NULL DEFAULT '',
  guardian_email VARCHAR(190) NOT NULL DEFAULT '',
  school VARCHAR(120) NOT NULL DEFAULT '',
  batch_id INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'AED',
  active TINYINT(1) NOT NULL DEFAULT 1,
  reel_consent ENUM('unknown','granted','denied') NOT NULL DEFAULT 'unknown',
  reel_consent_at DATETIME(3) NULL,
  reel_consent_by INT UNSIGNED NULL,
  reel_consent_note VARCHAR(300) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_students_email (email),
  KEY ix_students_batch (batch_id),
  KEY ix_students_school (school),
  CONSTRAINT fk_students_batch FOREIGN KEY (batch_id) REFERENCES batches(id)
) ENGINE=InnoDB;

ALTER TABLE users ADD CONSTRAINT fk_users_student FOREIGN KEY (student_id) REFERENCES students(id);

CREATE TABLE student_subjects (
  student_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (student_id, subject_id),
  CONSTRAINT fk_ss_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_ss_subject FOREIGN KEY (subject_id) REFERENCES subjects(id)
) ENGINE=InnoDB;

CREATE TABLE classes (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id INT UNSIGNED NOT NULL,
  subject_id INT UNSIGNED NOT NULL,
  teacher_id INT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  agenda VARCHAR(500) NOT NULL DEFAULT '',
  start_at DATETIME(3) NOT NULL,
  duration_min SMALLINT UNSIGNED NOT NULL,
  status ENUM('scheduled','cancelled') NOT NULL DEFAULT 'scheduled',
  cancel_reason VARCHAR(300) NOT NULL DEFAULT '',
  zoom_meeting_id VARCHAR(40) NULL,
  zoom_uuid VARCHAR(120) NULL,
  join_url VARCHAR(500) NOT NULL DEFAULT '',
  start_url VARCHAR(1500) NULL,
  link_source ENUM('zoom','manual') NOT NULL DEFAULT 'manual',
  attendance_taken_at DATETIME(3) NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_classes_start (start_at),
  KEY ix_classes_batch_subject (batch_id, subject_id, start_at),
  KEY ix_classes_teacher (teacher_id, start_at),
  CONSTRAINT fk_classes_batch FOREIGN KEY (batch_id) REFERENCES batches(id),
  CONSTRAINT fk_classes_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_classes_teacher FOREIGN KEY (teacher_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE attendance (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  status ENUM('present','late','absent') NOT NULL,
  join_time DATETIME(3) NULL,
  leave_time DATETIME(3) NULL,
  duration_sec INT UNSIGNED NULL,
  source ENUM('zoom','manual') NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  created_by INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  updated_by INT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_attendance (class_id, student_id),
  KEY ix_attendance_student (student_id, class_id),
  CONSTRAINT fk_att_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_att_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

CREATE TABLE attendance_zoom (
  class_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  status ENUM('present','late','absent') NOT NULL,
  join_time DATETIME(3) NULL,
  leave_time DATETIME(3) NULL,
  duration_sec INT UNSIGNED NULL,
  synced_at DATETIME(3) NOT NULL,
  PRIMARY KEY (class_id, student_id),
  CONSTRAINT fk_attz_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE,
  CONSTRAINT fk_attz_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB;

CREATE TABLE attendance_audit (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  class_id INT UNSIGNED NOT NULL,
  student_id INT UNSIGNED NOT NULL,
  changed_by INT UNSIGNED NULL,
  changed_by_name VARCHAR(120) NOT NULL,
  changed_at DATETIME(3) NOT NULL,
  old_value JSON NULL,
  new_value JSON NOT NULL,
  reason VARCHAR(300) NOT NULL DEFAULT '',
  KEY ix_audit_class (class_id, id),
  CONSTRAINT fk_audit_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE kv (
  k VARCHAR(80) PRIMARY KEY,
  v TEXT NOT NULL
) ENGINE=InnoDB;

INSERT INTO subjects (code, name) VALUES ('chem', 'Chemistry'), ('phys', 'Physics'), ('math', 'Mathematics');
