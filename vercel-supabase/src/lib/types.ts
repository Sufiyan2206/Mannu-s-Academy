export type SubjectId = 'chem' | 'phys' | 'math';
export type Role = 'admin' | 'teacher';

export interface Profile { id: string; full_name: string; email: string; role: Role; active: boolean; created_at: string }

export interface Settings {
  academy: string; tz: string; currency: string; currencies: string[];
  min_pct: number; late_after: number; classes_per_month: number; monthly_fee: number; due_day: number;
  cc: string; contact: string; ig_handle: string;
  publish_mode: 'auto' | 'approval' | 'off'; yt_privacy: 'private' | 'unlisted' | 'public';
  reel_len_sec: number; reel_start_sec: number; keep_original_days: number;
}

export interface Batch { id: string; name: string }

export interface Student {
  id: string; name: string; email: string; zoom_email: string; mobile: string;
  guardian_name: string; guardian_mobile: string; guardian_email: string; school: string;
  batch_id: string; currency: string; subjects: SubjectId[]; active: boolean; created_at: string;
}

export interface ClassRow {
  id: string; batch_id: string; subject_id: SubjectId; title: string; start_at: string; duration_min: number;
  teacher_name: string; teacher_phone: string; join_url: string; agenda: string;
  status: 'scheduled' | 'cancelled'; cancel_reason: string; created_by: string; created_at: string;
}

export type AttStatus = 'present' | 'late' | 'absent';
export interface AttRow {
  student_id: string; status: AttStatus; join_time: string | null; leave_time: string | null; duration_sec: number | null;
  source: 'manual' | 'zoom'; note: string; created_by: string; created_at: string; updated_by: string; updated_at: string;
}
export interface ZoomRow { student_id: string; status: AttStatus; join_time: string | null; leave_time: string | null; duration_sec: number | null }
export interface Unmatched { name: string; email: string; duration_sec: number; reason: string }
export interface AttAudit { student_id: string; old_value: { status?: string; source?: string; note?: string } | null; new_value: { status: string; source: string; note: string }; reason: string; by_name: string; at: string }
export interface AttDoc { taken_at: string | null; unmatched: Unmatched[]; rows: Record<string, AttRow>; zoom: Record<string, ZoomRow>; audit: AttAudit[] }

export interface FeeRate { id: string; subject_id: SubjectId; batch_id: string | null; student_id: string | null; currency: string; cents: number }
export interface FeeCharge {
  id: string; student_id: string; subject_id: SubjectId | null; period: string | null; description: string;
  currency: string; cents: number; due_date: string; voided: boolean; created_at: string;
}
export type PayMethod = 'cash' | 'bank_transfer' | 'online';
export interface Payment {
  id: string; receipt_no: string; student_id: string; currency: string; cents: number; paid_currency: string; paid_cents: number;
  rate: number; method: PayMethod; reference: string; note: string; paid_at: string; received_by: string; voided: boolean; void_reason: string;
}
export interface ParentSend {
  id: string; student_id: string; subject_id: SubjectId; month: string; channel: 'whatsapp' | 'email'; to_address: string;
  by_name: string; at: string; hash: string; summary: { held: number; attended: number; missed: number; percent: number | null; fee_state: string };
}
export interface MessageLog {
  id: string; ts: string; by_name: string; kind: string; student_id: string | null; class_id: string | null;
  recipient_role: string; recipient_name: string; to_number: string; body: string; status: string;
}

export type ResType = 'notes' | 'worksheet' | 'question_paper' | 'model_paper' | 'presentation' | 'image' | 'video' | 'other';
export type ExamType = 'none' | 'class_test' | 'term_exam' | 'mock_exam' | 'final_exam' | 'assignment' | 'revision';
export interface Resource {
  id: string; title: string; subject_id: SubjectId; type: ResType; exam_type: ExamType; batch_ids: string[]; url: string;
  topic: string; date: string; description: string; instructions: string; tags: string[]; class_id: string | null;
  status: 'active' | 'removed'; by_id: string | null; by_name: string; created_at: string; updated_at: string; updated_by: string;
}
export interface ResHistory { id: number; resource_id: string; action: string; by_name: string; at: string; changes: Record<string, [string, string]> | null; note: string }

export interface Reel {
  id: string; title: string; subject_id: SubjectId; batch_id: string; topic: string; teacher_name: string;
  clip_url: string; clip_path: string | null; clip_len: number | null; yt_url: string; yt_start: number; caption: string;
  appears: 'none' | 'students' | null; appearing: string[]; rev: number; submitted: boolean; submitted_at: string | null;
  discarded: boolean; recording_id: string | null; by_id: string | null; by_name: string; created_at: string; updated_at: string;
}
export interface ReelMetrics { views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saved: number | null; as_of?: string }
export interface ReelDecision {
  reel_id: string; state: 'approved' | 'rejected' | 'published' | 'failed' | 'deleted'; rev: number | null; scheduled_at: string | null;
  note: string; error: string; prev: string; ig_url: string; ig_media_id: string | null; published_at: string | null;
  appears: string | null; metrics: ReelMetrics | null; by_name: string; at: string;
}
export interface ReelHistory { id: number; reel_id: string; scope: 'draft' | 'decision'; action: string; by_name: string; at: string; note: string }
export interface ConsentRow { student_id: string; status: 'granted' | 'denied' | 'unknown'; note: string; by_name: string; at: string }
export interface ConsentLog { id: number; student_id: string; name: string; status: string; note: string; by_name: string; at: string }

export type RecStage = 'uploading' | 'queued' | 'youtube' | 'trim' | 'instagram' | 'completed' | 'held' | 'failed' | 'cancelled';
export interface RecStep { at: string; step: string; note?: string }
export interface Recording {
  id: string; class_id: string | null; title: string; subject_id: SubjectId; batch_id: string; topic: string; teacher_name: string;
  source_path: string | null; source_url: string | null; source_kind: 'upload' | 'zoom'; source_size: number | null; source_mime: string;
  appears: 'none' | 'students' | null; appearing: string[]; trim_start_sec: number; trim_len_sec: number;
  publish_mode: 'auto' | 'approval' | 'off'; yt_privacy: 'private' | 'unlisted' | 'public'; stage: RecStage;
  yt_session_uri: string | null; yt_offset: number; yt_video_id: string | null; yt_url: string; clip_path: string | null;
  reel_id: string | null; ig_container_id: string | null; ig_media_id: string | null; ig_url: string; hold_released: boolean;
  attempts: number; last_error: string; next_attempt_at: string; locked_until: string | null; steps: RecStep[];
  original_deleted: boolean; by_id: string | null; by_name: string; created_at: string; updated_at: string;
}
