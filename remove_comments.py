from pathlib import Path

path = Path('protected/js/adminPage.js')
text = path.read_text(encoding='utf-8')
result = []
state = 'normal'
i = 0
while i < len(text):
    c = text[i]
    if state == 'normal':
        if text.startswith('//', i):
            state = 'line_comment'
            i += 2
            continue
        if text.startswith('/*', i):
            state = 'block_comment'
            i += 2
            continue
        if c == '"':
            result.append(c)
            state = 'double'
        elif c == "'":
            result.append(c)
            state = 'single'
        elif c == '`':
            result.append(c)
            state = 'template'
        else:
            result.append(c)
    elif state == 'line_comment':
        if c == '\n':
            result.append(c)
            state = 'normal'
    elif state == 'block_comment':
        if text.startswith('*/', i):
            i += 2
            state = 'normal'
            continue
    elif state == 'double':
        result.append(c)
        if c == '\\' and i + 1 < len(text):
            result.append(text[i+1])
            i += 1
        elif c == '"':
            state = 'normal'
    elif state == 'single':
        result.append(c)
        if c == '\\' and i + 1 < len(text):
            result.append(text[i+1])
            i += 1
        elif c == "'":
            state = 'normal'
    elif state == 'template':
        result.append(c)
        if c == '\\' and i + 1 < len(text):
            result.append(text[i+1])
            i += 1
        elif c == '`':
            state = 'normal'
    i += 1

path.write_text(''.join(result), encoding='utf-8')
print('comments removed')
