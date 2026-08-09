export interface IntroSection {
  fullName: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  website?: string;
  summary: string;
  avatarUrl?: string;
}

export interface ExperienceItem {
  id: string;
  title: string;
  company: string;
  startDate: string;
  endDate: string;
  current: boolean;
  /**
   * Từng gạch đầu dòng là một phần tử riêng, không phải một khối văn bản.
   *
   * Chat sinh JSON Patch nhắm vào /sections/experience/0/highlights/2. Nếu đây
   * là một chuỗi, mọi đề xuất của AI biến thành ghi đè nguyên khối và màn duyệt
   * diff chỉ còn "toàn bộ đoạn cũ" đổi thành "toàn bộ đoạn mới" — không còn gì
   * đáng để người dùng duyệt.
   */
  highlights: string[];
}

export interface ProjectItem {
  id: string;
  name: string;
  role: string;
  startDate: string;
  endDate: string;
  link?: string;
  /**
   * Từng gạch đầu dòng là một phần tử riêng, không phải một khối văn bản.
   *
   * Chat sinh JSON Patch nhắm vào /sections/projects/0/highlights/2. Nếu đây
   * là một chuỗi, mọi đề xuất của AI biến thành ghi đè nguyên khối và màn duyệt
   * diff chỉ còn "toàn bộ đoạn cũ" đổi thành "toàn bộ đoạn mới" — không còn gì
   * đáng để người dùng duyệt.
   */
  highlights: string[];
}

export interface EducationItem {
  id: string;
  school: string;
  degree: string;
  fieldOfStudy: string;
  startDate: string;
  endDate: string;
  gpa?: string;
}

export interface SkillItem {
  id: string;
  category: string; // e.g. "Core AI", "MLOps", "Programming"
  skills: string; // Comma separated or list
}

export interface ActivityItem {
  id: string;
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
  /**
   * Từng gạch đầu dòng là một phần tử riêng, không phải một khối văn bản.
   *
   * Chat sinh JSON Patch nhắm vào /sections/activities/0/highlights/2. Nếu đây
   * là một chuỗi, mọi đề xuất của AI biến thành ghi đè nguyên khối và màn duyệt
   * diff chỉ còn "toàn bộ đoạn cũ" đổi thành "toàn bộ đoạn mới" — không còn gì
   * đáng để người dùng duyệt.
   */
  highlights: string[];
}

export interface CertificationItem {
  id: string;
  name: string;
  issuer: string;
  date: string;
  link?: string;
}

export interface LanguageItem {
  id: string;
  language: string;
  proficiency: string; // Native, Fluent, Intermediate, Basic
}

export interface CVSections {
  intro: IntroSection;
  experience: ExperienceItem[];
  projects: ProjectItem[];
  education: EducationItem[];
  skills: SkillItem[];
  activities: ActivityItem[];
  certifications: CertificationItem[];
  languages: LanguageItem[];
}

export interface CVDesign {
  template: 'modern' | 'classic' | 'professional';
  accentColor: string; // e.g. '#00897B', '#2563EB', '#7C3AED', '#EA580C'
  font: 'Roboto' | 'Open Sans' | 'Lato';
  fontSize: number; // e.g. 12 - 24
  spacing: 'condensed' | 'normal' | 'wide';
}

export interface CV {
  id: string;
  title: string;
  lastModified: string;
  sections: CVSections;
  design: CVDesign;
  activeSections: {
    intro: boolean;
    experience: boolean;
    projects: boolean;
    education: boolean;
    skills: boolean;
    activities: boolean;
    certifications: boolean;
    languages: boolean;
  };
}

export type ViewTab =
  | 'dashboard'
  | 'my_cvs'
  | 'job_match'
  | 'ai_assistant'
  | 'templates'
  | 'settings'
  | 'editor';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
  suggestedAction?: {
    type: 'apply_text';
    targetSection: string;
    content: string;
  };
}

export interface JobMatchResult {
  matchScore: number;
  analysis: string;
  strengths: string[];
  missingKeywords: string[];
  recommendations: string;
}
