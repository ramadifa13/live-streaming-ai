"""Overlay Generator: Render visual overlay (banner promo & product card) using PIL."""

from __future__ import annotations

import base64
import math
import os
import re
import urllib.request
from typing import Optional, Tuple
from PIL import Image, ImageDraw, ImageFilter, ImageFont


def download_or_decode_image(url_or_data: str, target_path: str, default_ext: str = ".png") -> Optional[str]:
    """Download or decode base64/HTTP image to local file path."""
    if not url_or_data or not url_or_data.strip():
        return None
    src = url_or_data.strip()
    if src.startswith("data:image/"):
        try:
            _, encoded = src.split(",", 1)
            img_data = base64.b64decode(encoded)
            with open(target_path, "wb") as f:
                f.write(img_data)
            return target_path
        except Exception as e:
            print(f"[OVERLAY ERROR] Gagal decode base64: {e}")
            return None
    elif src.startswith("http://") or src.startswith("https://"):
        try:
            req = urllib.request.Request(
                src,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            )
            with urllib.request.urlopen(req, timeout=15) as response, open(target_path, "wb") as out_file:
                out_file.write(response.read())
            return target_path
        except Exception as e:
            print(f"[OVERLAY ERROR] Gagal download dari {src}: {e}")
            return None
    elif os.path.exists(src):
        return src
    return None


def resolve_fonts() -> Tuple[ImageFont.ImageFont, ImageFont.ImageFont, ImageFont.ImageFont]:
    """Find and load suitable fonts for product card text."""
    font_name = None
    font_price = None
    font_strike = None

    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for font_path in candidates:
        if os.path.exists(font_path):
            try:
                font_name = ImageFont.truetype(font_path, 25)
                font_price = ImageFont.truetype(font_path, 34)
                font_strike = ImageFont.truetype(font_path, 21)
                break
            except Exception:
                pass

    if not font_name:
        font_name = ImageFont.load_default()
        font_price = ImageFont.load_default()
        font_strike = ImageFont.load_default()

    return font_name, font_price, font_strike


def render_pil_overlay(
    tmp_dir: str,
    output_folder: str,
    local_banner_img: Optional[str] = None,
    local_product_img: Optional[str] = None,
    product_name: str = "",
    product_price: str = "",
    canvas_w: int = 720,
    canvas_h: int = 1280,
) -> Optional[str]:
    """Render 720x1280 RGBA live overlay with banner and product card."""
    overlay = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

    has_banner = bool(local_banner_img and os.path.exists(local_banner_img))
    has_product = bool(product_name or product_price or (local_product_img and os.path.exists(local_product_img)))

    if not has_banner and not has_product:
        return None

    if has_banner and local_banner_img:
        try:
            banner_max_w, banner_max_h, banner_y = 540, 245, 12
            banner = Image.open(local_banner_img).convert("RGBA")
            banner.thumbnail((banner_max_w, banner_max_h), Image.Resampling.LANCZOS)
            bw, bh = banner.size
            bx = (canvas_w - bw) // 2
            by = banner_y

            shadow_banner = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
            sb_draw = ImageDraw.Draw(shadow_banner)
            sb_draw.rounded_rectangle((bx, by + 4, bx + bw, by + bh + 4), radius=20, fill=(0, 0, 0, 90))
            shadow_banner = shadow_banner.filter(ImageFilter.GaussianBlur(radius=8))
            overlay = Image.alpha_composite(overlay, shadow_banner)

            b_mask = Image.new("L", (bw, bh), 0)
            b_draw = ImageDraw.Draw(b_mask)
            b_draw.rounded_rectangle((0, 0, bw, bh), radius=20, fill=255)

            overlay.paste(banner, (bx, by), b_mask)
            print(f"[OVERLAY] Banner diperbesar & ditempelkan di posisi ({bx}, {by}) ukuran {bw}x{bh}")
        except Exception as e:
            print(f"[OVERLAY ERROR] Gagal merender banner: {e}")

    if has_product:
        card_w, card_h = 630, 138
        card_x = (canvas_w - card_w) // 2
        card_y = canvas_h - card_h - 150
        radius = 24

        shadow_card = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        sc_draw = ImageDraw.Draw(shadow_card)
        sc_draw.rounded_rectangle(
            (card_x, card_y + 8, card_x + card_w, card_y + card_h + 8),
            radius=radius,
            fill=(0, 0, 0, 85),
        )
        shadow_card = shadow_card.filter(ImageFilter.GaussianBlur(radius=14))
        overlay = Image.alpha_composite(overlay, shadow_card)

        card_img = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
        card_draw = ImageDraw.Draw(card_img)
        card_draw.rounded_rectangle(
            (0, 0, card_w, card_h),
            radius=radius,
            fill=(255, 255, 255, 250),
            outline=(226, 232, 240, 255),
            width=2,
        )
        overlay.paste(card_img, (card_x, card_y), card_img)
        draw = ImageDraw.Draw(overlay)

        thumb_size = 106
        thumb_x = card_x + 18
        thumb_y = card_y + 17

        if local_product_img and os.path.exists(local_product_img):
            try:
                p_img = Image.open(local_product_img).convert("RGBA")
                p_img = p_img.resize((thumb_size, thumb_size), Image.Resampling.LANCZOS)

                p_mask = Image.new("L", (thumb_size, thumb_size), 0)
                pm_draw = ImageDraw.Draw(p_mask)
                pm_draw.rounded_rectangle((0, 0, thumb_size, thumb_size), radius=16, fill=255)

                overlay.paste(p_img, (thumb_x, thumb_y), p_mask)
                draw.rounded_rectangle(
                    (thumb_x, thumb_y, thumb_x + thumb_size, thumb_y + thumb_size),
                    radius=16,
                    outline=(226, 232, 240, 255),
                    width=2,
                )
            except Exception as e:
                print(f"[OVERLAY ERROR] Gagal rendering thumbnail: {e}")

        text_x = thumb_x + thumb_size + 20
        font_name, font_price, font_strike = resolve_fonts()

        if product_name:
            clean_name = product_name[:26]
            draw.text((text_x, card_y + 26), clean_name, font=font_name, fill=(15, 23, 42, 255))

        raw_price = 0
        if product_price:
            digits = re.sub(r"[^0-9]", "", str(product_price))
            if digits:
                raw_price = int(digits)

        if raw_price > 0:
            current_price_str = f"Rp{raw_price:,}".replace(",", ".")
            auto_orig_price = int(math.ceil((raw_price * 1.35) / 5000.0) * 5000)
            strikethrough_str = f"Rp{auto_orig_price:,}".replace(",", ".")

            draw.text((text_x, card_y + 70), current_price_str, font=font_price, fill=(225, 29, 72, 255))

            bbox = font_price.getbbox(current_price_str)
            price_w = bbox[2] - bbox[0] if bbox else 150

            strike_x = text_x + price_w + 16
            strike_y = card_y + 80

            draw.text((strike_x, strike_y), strikethrough_str, font=font_strike, fill=(148, 163, 184, 255))

            s_bbox = font_strike.getbbox(strikethrough_str)
            strike_w = s_bbox[2] - s_bbox[0] if s_bbox else 80
            line_y = strike_y + 11
            draw.line((strike_x - 2, line_y, strike_x + strike_w + 2, line_y), fill=(148, 163, 184, 255), width=2)
        elif product_price:
            draw.text((text_x, card_y + 70), str(product_price), font=font_price, fill=(225, 29, 72, 255))

    out_path = os.path.join(tmp_dir, "live_overlay.png")
    overlay.save(out_path, "PNG")
    public_overlay = os.path.join(output_folder, "overlay_live.png")
    try:
        overlay.save(public_overlay, "PNG")
    except Exception as e:
        print(f"[OVERLAY ERROR] Gagal salin overlay_live.png: {e}")
    print(f"[OVERLAY] PIL Live Overlay berhasil dirender: {out_path}")
    return out_path


def prepare_overlay_files(
    output_folder: str,
    product_name: str = "",
    product_price: str = "",
    product_image_url: str = "",
    banner_image_url: str = "",
) -> Optional[str]:
    """Download/decode assets and render PNG overlay in output_folder."""
    tmp_dir = os.path.join(output_folder, "tmp_assets")
    os.makedirs(tmp_dir, exist_ok=True)

    local_product_img = None
    if product_image_url and product_image_url.strip():
        local_product_img = download_or_decode_image(
            product_image_url,
            os.path.join(tmp_dir, "product_thumb.png"),
        )
        if local_product_img:
            print(f"[OVERLAY] Foto Produk siap: {local_product_img}")

    local_banner_img = None
    if banner_image_url and banner_image_url.strip():
        local_banner_img = download_or_decode_image(
            banner_image_url,
            os.path.join(tmp_dir, "banner_promo.png"),
        )
        if local_banner_img:
            print(f"[OVERLAY] Banner Promo siap: {local_banner_img}")

    return render_pil_overlay(
        tmp_dir=tmp_dir,
        output_folder=output_folder,
        local_banner_img=local_banner_img,
        local_product_img=local_product_img,
        product_name=product_name,
        product_price=product_price,
    )
