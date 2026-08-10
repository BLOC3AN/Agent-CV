/** Review contract shared by the V2 import-review UI and its API. */

export type ReviewKind =
  | 'intro'
  | 'education'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'activities'
  | 'certifications'
  | 'languages'

export interface ReviewField {
  path: string
  label: string
  value: string
  empty: boolean
}

export interface ReviewItem {
  kind: ReviewKind
  path: string
  title: string
  fields: ReviewField[]
}

export const REVIEW_LABELS: Record<ReviewKind, string> = {
  intro: 'Thông tin cá nhân',
  education: 'Học vấn',
  experience: 'Kinh nghiệm',
  projects: 'Dự án',
  skills: 'Kỹ năng',
  activities: 'Hoạt động',
  certifications: 'Chứng chỉ',
  languages: 'Ngoại ngữ',
}
