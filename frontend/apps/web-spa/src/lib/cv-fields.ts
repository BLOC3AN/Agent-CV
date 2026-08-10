import type { CVFieldDefinition } from '../types'

/** The v1 registered-field catalog shared by editing, AI validation, and rendering. */
export const CV_FIELD_CATALOG: readonly CVFieldDefinition[] = [
  { key: 'role', label: 'Role', valueType: 'text', allowedIn: ['experience', 'projects'], printStyle: 'inline' },
  { key: 'company', label: 'Company', valueType: 'text', allowedIn: ['experience'], printStyle: 'inline' },
  { key: 'time', label: 'Time', valueType: 'date', allowedIn: ['experience', 'projects', 'education'], printStyle: 'date-range' },
  { key: 'teamSize', label: 'Team size', valueType: 'text', allowedIn: ['experience', 'projects'], printStyle: 'inline' },
  { key: 'techStack', label: 'Tech stack', valueType: 'tag-list', allowedIn: ['experience', 'projects'], printStyle: 'tags' },
  { key: 'highlights', label: 'Highlights', valueType: 'multiline', allowedIn: ['experience', 'projects'], printStyle: 'block' },
  { key: 'name', label: 'Name', valueType: 'text', allowedIn: ['projects'], printStyle: 'inline' },
  { key: 'contribution', label: 'Contribution', valueType: 'multiline', allowedIn: ['projects'], printStyle: 'block' },
  { key: 'careerObjective', label: 'Career objective', valueType: 'multiline', allowedIn: ['header', 'summary'], printStyle: 'block' },
  { key: 'availability', label: 'Availability', valueType: 'text', allowedIn: ['header', 'summary'], printStyle: 'inline' },
  { key: 'location', label: 'Location', valueType: 'text', allowedIn: ['header', 'summary'], printStyle: 'inline' },
  { key: 'school', label: 'School', valueType: 'text', allowedIn: ['education'], printStyle: 'inline' },
  { key: 'degree', label: 'Degree', valueType: 'text', allowedIn: ['education'], printStyle: 'inline' },
  { key: 'field', label: 'Field', valueType: 'text', allowedIn: ['education'], printStyle: 'inline' },
  { key: 'gpa', label: 'GPA', valueType: 'text', allowedIn: ['education'], printStyle: 'inline' },
]

export const CV_FIELDS = CV_FIELD_CATALOG
