#!/usr/bin/env python3
"""Dựng bộ favicon từ public/logo.png.

Chạy lại khi logo đổi:  python3 scripts/make-favicons.py

Hai quyết định trong này không hiển nhiên, đừng gỡ bỏ khi sửa:

1. NỀN TRẮNG BO GÓC, không dùng thẳng logo trong suốt. Nét logo là #00001e —
   gần như đen. Trên tab của trình duyệt chạy theme tối, một hình gần-đen nền
   trong suốt là một ô trống. Nền trắng làm nó hiện rõ ở cả hai theme.

2. CỠ NHỎ DÙNG logo_ratio LỚN HƠN. Ở 32px, biểu tượng vô cực chỉ còn nét dày
   2px; để logo chiếm 78% khung như cỡ lớn thì nó nhoè thành một vệt xám.
   Chiếm 90% khung thì nét dày lên và đọc được. Bù lại phải giảm bo góc, nếu
   không góc bo ăn vào nét.

apple-touch-icon là ngoại lệ: iOS tự bo góc và không xử lý alpha tử tế, nên
file đó phải vuông, đặc, không alpha.
"""

import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, '..', 'public')
SRC = os.path.join(PUBLIC, 'logo.png')

# Dựng ở kích thước gấp 4 rồi thu nhỏ: cạnh bo và nét cong mượt hơn hẳn so với
# vẽ thẳng ở cỡ đích.
SUPERSAMPLE = 4


def build(size, radius_ratio=0.22, logo_ratio=0.78, flatten=False):
    base = Image.open(SRC).convert('RGBA')
    logo = base.crop(base.getbbox())  # bỏ viền trong suốt thừa quanh nét

    s = size * SUPERSAMPLE
    canvas = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).rounded_rectangle(
        [0, 0, s - 1, s - 1], radius=int(s * radius_ratio), fill=(255, 255, 255, 255)
    )

    w = int(s * logo_ratio)
    h = int(w * logo.height / logo.width)
    canvas.alpha_composite(logo.resize((w, h), Image.LANCZOS), ((s - w) // 2, (s - h) // 2))

    out = canvas.resize((size, size), Image.LANCZOS)
    return out.convert('RGB') if flatten else out


def main():
    out = lambda name: os.path.join(PUBLIC, name)

    build(32, radius_ratio=0.18, logo_ratio=0.90).save(out('favicon-32.png'))
    build(64, radius_ratio=0.18, logo_ratio=0.90).save(
        out('favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)]
    )
    build(192).save(out('favicon-192.png'))
    build(512).save(out('favicon-512.png'))
    build(180, radius_ratio=0, logo_ratio=0.82, flatten=True).save(out('apple-touch-icon.png'))

    for name in sorted(os.listdir(PUBLIC)):
        print(f'{name:24} {os.path.getsize(out(name)):>8,} bytes')


if __name__ == '__main__':
    main()
