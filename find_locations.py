import re

with open('src/pages/Sales.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

with open('locations.txt', 'w', encoding='utf-8') as out:
    for i, line in enumerate(lines):
        if '<th' in line and ('Price' in line or 'Total' in line):
            out.write(f'Table Header: {i} - {line.strip()}\n')
        if 'setCartItems((prev)' in line and 'qty:' in line:
            out.write(f'Update Cart: {i} - {line.strip()}\n')
        if 'subTotal =' in line:
            out.write(f'Subtotal Calc: {i} - {line.strip()}\n')
        if 'const discount =' in line or 'setDiscount' in line:
            out.write(f'Global Discount State: {i} - {line.strip()}\n')
        if 'const [discount' in line:
            out.write(f'State def: {i} - {line.strip()}\n')
