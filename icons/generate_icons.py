#!/usr/bin/env python3
"""Generate Mento Lens icons using Pillow (PIL)."""

from PIL import Image, ImageDraw
import os

SIZES = [16, 32, 48, 128]

# Colors
WHITE = (255, 255, 255)
SLATE = (84, 110, 122)    # #546E7A
ORANGE = (255, 152, 0)    # #FF9800


def draw_icon(size):
    """Draw the Mento Lens icon at the given size."""
    img = Image.new('RGBA', (size, size), WHITE)
    draw = ImageDraw.Draw(img)
    
    scale = size / 128.0
    
    def s(val):
        return int(val * scale)
    
    # Draw corner brackets
    bracket_length = s(40)
    bracket_thickness = max(1, s(10))
    margin = s(12)
    
    # Top-left bracket
    draw.rectangle([margin, margin, margin + bracket_length, margin + bracket_thickness], fill=SLATE)
    draw.rectangle([margin, margin, margin + bracket_thickness, margin + bracket_length], fill=SLATE)
    
    # Top-right bracket
    draw.rectangle([size - margin - bracket_length, margin, size - margin, margin + bracket_thickness], fill=SLATE)
    draw.rectangle([size - margin - bracket_thickness, margin, size - margin, margin + bracket_length], fill=SLATE)
    
    # Bottom-left bracket
    draw.rectangle([margin, size - margin - bracket_thickness, margin + bracket_length, size - margin], fill=SLATE)
    draw.rectangle([margin, size - margin - bracket_length, margin + bracket_thickness, size - margin], fill=SLATE)
    
    # Bottom-right bracket
    draw.rectangle([size - margin - bracket_length, size - margin - bracket_thickness, size - margin, size - margin], fill=SLATE)
    draw.rectangle([size - margin - bracket_thickness, size - margin - bracket_length, size - margin, size - margin], fill=SLATE)
    
    # Draw star (8-pointed)
    center_x = size // 2
    center_y = size // 2
    
    # Star parameters (relative to 128x128)
    outer_r = s(42)   # outer radius
    inner_r = s(16)   # inner radius
    
    points = []
    for i in range(16):
        angle = (i * 22.5 - 90) * 3.14159 / 180  # Start from top, 22.5 degree increments
        if i % 2 == 0:
            r = outer_r
        else:
            r = inner_r
        x = center_x + int(r * (1 if i == 0 or i == 8 else (0 if i == 4 or i == 12 else (1 if i < 4 or i > 12 else -1) if i in [1,2,3,13,14,15] else (-1 if i in [5,6,7,9,10,11] else 0))))
        # Simpler approach: calculate using sin/cos
        import math
        x = center_x + int(r * math.cos(angle))
        y = center_y + int(r * math.sin(angle))
        points.append((x, y))
    
    draw.polygon(points, fill=ORANGE)
    
    return img


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    for size in SIZES:
        img = draw_icon(size)
        png_path = os.path.join(script_dir, f'icon{size}.png')
        img.save(png_path, 'PNG')
        print(f"Generated {png_path}")
    
    print("Done!")


if __name__ == '__main__':
    main()
