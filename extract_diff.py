import json

log_path = r'C:\Users\amash\.gemini\antigravity-ide\brain\8af030b5-bc5e-42c7-9fde-2518499091ab\.system_generated\logs\transcript_full.jsonl'
patch_path = r'C:\Users\amash\OneDrive\Desktop\Hardware\hardwarer\restore.patch'

found = False
with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        # Looking for the step where git diff HEAD was executed and we got output
        if 'git diff HEAD' in line and 'TOOL_RESPONSE' in line:
            try:
                data = json.loads(line)
                if data.get('type') == 'RUN_COMMAND':
                    content = data.get('content', '')
                    if 'diff --git a/src/pages/Sales.tsx' in content:
                        diff_start = content.rfind('diff --git a/src/pages/Sales.tsx')
                        diff_text = content[diff_start:]
                        # Clean up trailing JSON characters if present in the raw string
                        if diff_text.endswith('"\n'):
                            diff_text = diff_text[:-2]
                        elif diff_text.endswith('"'):
                            diff_text = diff_text[:-1]
                        
                        # Replace carriage returns that might break git apply
                        diff_text = diff_text.replace('\r\n', '\n')
                        
                        with open(patch_path, 'w', encoding='utf-8') as out:
                            out.write(diff_text)
                        found = True
                        print('Found and extracted REAL diff!')
            except Exception as e:
                pass

if not found:
    print('Still not found.')
