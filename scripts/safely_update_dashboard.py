with open('public/js/dashboard.js', 'r', encoding='utf-8') as f:
    content = f.read()

initial_lines = len(content.splitlines())
print('Initial lines:', initial_lines)

target1 = '''            <tr>
                <td colspan="8" style="text-align: center; color: var(--text-dim); padding: 40px;">'''
repl1 = '''            <tr>
                <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 40px;">'''

target2 = '''                <td style="text-align: center;">
                    ${langBadge}
                </td>
                <td style="text-align: center; font-weight: 600; color: #60a5fa; font-size: 13px;">
                    ${callCount > 0 ? `${callCount}` : '—'}
                </td>
                <td style="text-align: center; font-size: 12px; color: var(--text-muted);">'''

repl2 = '''                <td style="text-align: center;">
                    ${langBadge}
                </td>
                <td style="text-align: center; font-size: 12px; color: var(--text-muted);">'''

assert target1 in content, 'target1 not found'
assert target2 in content, 'target2 not found'
assert content.count(target1) == 1, 'target1 count != 1'
assert content.count(target2) == 1, 'target2 count != 1'

content = content.replace(target1, repl1).replace(target2, repl2)

final_lines = len(content.splitlines())
print('Final lines:', final_lines)
assert abs(initial_lines - final_lines) <= 5, f'Unexpected line difference: {initial_lines} vs {final_lines}'

with open('public/js/dashboard.js', 'w', encoding='utf-8', newline='') as f:
    f.write(content)

print('Successfully updated dashboard.js!')

