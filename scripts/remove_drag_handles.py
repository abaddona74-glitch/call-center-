import re

with open('viewer/public/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = re.compile(r'\s*<div class="tool-drag-handle"[^>]*>.*?</div>', re.DOTALL)
matches = pattern.findall(content)
print(f'Found {len(matches)} tool-drag-handle elements.')

new_content = pattern.sub('', content)

# Also reset padding-right on .tool-card-top in CSS if any
new_content = new_content.replace('padding-right: 32px;', '')

with open('viewer/public/index.html', 'w', encoding='utf-8') as f:
    f.write(new_content)

print('Successfully removed all tool-drag-handle elements!')
