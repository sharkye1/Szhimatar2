import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def create_dmg_background(output_path: str, width: int = 660, height: int = 400):
    scale = 2  # 2x rendering for ultra-crisp quality
    w, h = width * scale, height * scale
    
    # 1. Base gradient: sleek dark slate / obsidian (#0b0f19 to #1e293b)
    base = Image.new("RGBA", (w, h), (11, 15, 25, 255))
    draw_base = ImageDraw.Draw(base)
    for y in range(h):
        t = y / h
        r = int(11 * (1 - t) + 26 * t)
        g = int(15 * (1 - t) + 36 * t)
        b = int(25 * (1 - t) + 54 * t)
        draw_base.line([(0, y), (w, y)], fill=(r, g, b, 255))
        
    # 2. Ambient background lights (mesh glow)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    
    # Left soft ambient glow (cyan/blue under app)
    glow_draw.ellipse(
        [int(60 * scale), int(70 * scale), int(300 * scale), int(310 * scale)],
        fill=(56, 189, 248, 28) # #38bdf8
    )
    # Right soft ambient glow (purple/indigo under Applications)
    glow_draw.ellipse(
        [int(360 * scale), int(70 * scale), int(600 * scale), int(310 * scale)],
        fill=(129, 140, 248, 25) # #818cf8
    )
    # Center glow
    glow_draw.ellipse(
        [int(250 * scale), int(120 * scale), int(410 * scale), int(260 * scale)],
        fill=(56, 189, 248, 20)
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=45 * scale))
    base = Image.alpha_composite(base, glow)
    
    # 3. Vector layer for shapes, arrow, and text
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Subtle target rings around icon spots (radius 68pt)
    app_cx, app_cy = int(180 * scale), int(180 * scale)
    app_folder_cx, app_folder_cy = int(480 * scale), int(180 * scale)
    ring_r = int(68 * scale)
    
    for cx, cy in [(app_cx, app_cy), (app_folder_cx, app_folder_cy)]:
        # Outer soft dashed ring
        draw.ellipse(
            [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
            outline=(255, 255, 255, 20),
            width=scale
        )
        
    # Stylish Arrow connecting the two icons
    # Icon edge is approx cx ± 55*scale. Space between: 245*scale to 415*scale
    arrow_y = int(180 * scale)
    start_x = int(255 * scale)
    end_x = int(405 * scale)
    
    # Gradient arrow line
    line_w = int(3.5 * scale)
    draw.line([(start_x, arrow_y), (end_x - int(10 * scale), arrow_y)], fill=(56, 189, 248, 190), width=line_w)
    
    # Arrow head (modern sharp chevron)
    head_size = int(12 * scale)
    head_points = [
        (end_x, arrow_y),
        (end_x - head_size, arrow_y - head_size + int(2 * scale)),
        (end_x - head_size + int(3 * scale), arrow_y),
        (end_x - head_size, arrow_y + head_size - int(2 * scale)),
    ]
    draw.polygon(head_points, fill=(56, 189, 248, 230))
    
    # Subtle trailing dots on the left of the arrow
    for i, offset in enumerate([-24, -14, -4]):
        dot_x = start_x + int(offset * scale)
        dot_r = int((1.8 + i * 0.5) * scale)
        alpha = int(40 + i * 40)
        draw.ellipse([dot_x - dot_r, arrow_y - dot_r, dot_x + dot_r, arrow_y + dot_r], fill=(56, 189, 248, alpha))
        
    # 4. Fonts and Typography
    font_path = "/System/Library/Fonts/SFNS.ttf"
    if not os.path.exists(font_path):
        font_path = "/System/Library/Fonts/HelveticaNeue.ttc"
        
    try:
        font_title = ImageFont.truetype(font_path, int(21 * scale))
        font_sub = ImageFont.truetype(font_path, int(13 * scale))
        font_footer = ImageFont.truetype(font_path, int(11 * scale))
    except Exception as e:
        print(f"Font loading error: {e}")
        font_title = ImageFont.load_default()
        font_sub = ImageFont.load_default()
        font_footer = ImageFont.load_default()
        
    # Top Text
    title_text = "Перетяните Szhimatar в папку «Программы»"
    sub_text = "Drag Szhimatar to Applications to install"
    
    bbox_title = draw.textbbox((0, 0), title_text, font=font_title)
    title_w = bbox_title[2] - bbox_title[0]
    draw.text(((w - title_w) // 2, int(50 * scale)), title_text, font=font_title, fill=(248, 250, 252, 235)) # #f8fafc
    
    bbox_sub = draw.textbbox((0, 0), sub_text, font=font_sub)
    sub_w = bbox_sub[2] - bbox_sub[0]
    draw.text(((w - sub_w) // 2, int(82 * scale)), sub_text, font=font_sub, fill=(148, 163, 184, 170)) # #94a3b8
    
    # Bottom Footer
    footer_text = "Szhimatar  •  Офлайн видеокомпрессор"
    bbox_footer = draw.textbbox((0, 0), footer_text, font=font_footer)
    footer_w = bbox_footer[2] - bbox_footer[0]
    draw.text(((w - footer_w) // 2, int(355 * scale)), footer_text, font=font_footer, fill=(100, 116, 139, 140)) # #64748b
    
    # Composite overlay
    final_composite = Image.alpha_composite(base, overlay)
    
    # Downscale smoothly to 660x400
    final_img = final_composite.resize((width, height), Image.Resampling.LANCZOS)
    
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    final_img.save(output_path, "PNG", dpi=(72, 72))
    print(f"Generated DMG background: {output_path} ({width}x{height})")
    
    retina_path = output_path.replace(".png", "@2x.png")
    final_composite.save(retina_path, "PNG", dpi=(144, 144))
    print(f"Generated Retina DMG background: {retina_path} ({w}x{h})")

if __name__ == "__main__":
    out = os.path.abspath("src-tauri/background/dmg-background.png")
    create_dmg_background(out)
