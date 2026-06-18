import sys
sys.stdout.reconfigure(encoding='utf-8')
path = r'src/modules/live-meeting/controllers/live-meeting.controller.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
# Find the position after the getPresentAttendees method's closing brace
# Find last occurrence of UC-IMM-07 related code
marker = "  //  UC-IMM-07: View Live Meeting Participants"
# Actually, let's just find the last closing brace before the end
# Check where the last export/class end is
last_class_brace = content.rfind('\n}')
print('File length:', len(content))
print('Last brace at:', last_class_brace)
