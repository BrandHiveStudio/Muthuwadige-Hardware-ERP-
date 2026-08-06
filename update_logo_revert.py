import re

filepath = 'src/pages/Sales.tsx'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Fix creditDiscountAmt issue
content = content.replace(
    '''                            {creditDiscount > 0 && (
                              <div className="flex justify-between text-red-400">
                                <span>{t('Discount', 'වට්ටම')} ({creditDiscount}%):</span>
                                <span>-{symbol} {creditDiscountAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                              </div>
                            )}''',
    '''                            {creditDiscountAmt > 0 && (
                              <div className="flex justify-between text-red-400">
                                <span>{t('Discount', 'වට්ටම')}:</span>
                                <span>-{symbol} {creditDiscountAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                              </div>
                            )}'''
)

# 2. Update .logo-container CSS
content = content.replace(
    'width: 110px;\n            height: 140px;\n            background: #ffffff;',
    'width: 132px;\n            height: 168px;\n            background: #000000;'
)
content = content.replace(
    'max-width: 90px;\n            max-height: 120px;',
    'max-width: 108px;\n            max-height: 144px;'
)

# 3. Update ReceiptPreview modal logo
content = content.replace(
    'bg-white border border-gray-200 border-t-0 rounded-b-lg w-[85px] h-[115px]',
    'bg-black border border-gray-900 border-t-0 rounded-b-lg w-[102px] h-[138px]'
)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(content)
print("Updated successfully!")
