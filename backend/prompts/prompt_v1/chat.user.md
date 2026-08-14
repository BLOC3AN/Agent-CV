---
name: chat.user
version: prompt_v1
variables: [profile, history, answers, hint_block, message]
---
PROFILE:
{{profile}}

HISTORY:
{{history}}

ANSWERS:
{{answers}}{{hint_block}}

USER:
{{message}}
