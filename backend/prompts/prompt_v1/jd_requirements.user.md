---
name: jd_requirements.user
version: prompt_v1
variables: [jd]
---
Read this job description and return ONLY JSON with fields title, language, roleFamily, seniority, yearsRequired, hardSkills, softSkills, responsibilities, atsKeywords, education. Use arrays for skills and responsibilities. Do not invent requirements. JD:
{{jd}}
