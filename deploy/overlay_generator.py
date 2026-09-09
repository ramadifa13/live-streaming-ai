"""Overlay Generator: Render visual overlay (banner promo & product card) using PIL."""

from __future__ import annotations

import base64
import math
import os
import re
import urllib.request
from typing import Optional, Tuple
from PIL import Image, ImageDraw, ImageFilter, ImageFont


def download_or_decode_image(
    url_or_data: str, target_path: str, default_ext: str = ".png"
) -> Optional[str]:
    """Download or decode base64/HTTP image to local file path."""
    if not url_or_data or not url_or_data.strip():
        return None
    src = url_or_data.strip()
    if src.startswith("data:image/"):
        try:
            _, encoded = src.split(",", 1)
            img_data = base64.b64decode(encoded.strip())
            with open(target_path, "wb") as f:
                f.write(img_data)
            return target_path
        except Exception as e:
            print(f"[OVERLAY ERROR] Gagal decode data:image base64: {e}")
            return None
    elif src.startswith(("/9j/", "iVBORw", "UklGR", "R0lGO")) or (len(src) > 256 and not src.startswith(("http", "/", "\\")) and " " not in src[:64]):
        try:
            img_data = base64.b64decode(src)
            with open(target_path, "wb") as f:
                f.write(img_data)
            return target_path
        except Exception as e:
            print(f"[OVERLAY ERROR] Gagal decode raw base64: {e}")
    elif src.startswith("http://") or src.startswith("https://"):
        is_local_url = "localhost" in src or "127.0.0.1" in src
        if not is_local_url:
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

        try:
            from urllib.parse import urlparse
            path_part = urlparse(src).path.lstrip("/\\")
            if path_part:
                clean_url = path_part
                for cand in [
                    os.path.join("/workspace/live-streaming-ai/frontend/public", clean_url),
                    os.path.join(os.path.dirname(__file__), "../frontend/public", clean_url),
                    os.path.join("/workspace/ai_live_worker/assets", clean_url),
                    os.path.join(os.path.dirname(__file__), "assets", clean_url),
                    os.path.join(os.path.dirname(target_path), clean_url),
                    os.path.join(os.path.dirname(target_path), "..", clean_url),
                ]:
                    if os.path.isfile(cand):
                        return cand
        except Exception:
            pass

    elif os.path.exists(src):
        return src

    clean = src.lstrip("/\\")
    for cand in [
        os.path.join("/workspace/live-streaming-ai/frontend/public", clean),
        os.path.join(os.path.dirname(__file__), "../frontend/public", clean),
        os.path.join("/workspace/ai_live_worker/assets", clean),
        os.path.join(os.path.dirname(__file__), "assets", clean),
        os.path.join(os.path.dirname(target_path), clean),
        os.path.join(os.path.dirname(target_path), "..", clean),
    ]:
        if os.path.isfile(cand):
            return cand

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
            # Banner box design matching frontend: width 540, height 140, top margin 24
            bw, bh = 540, 200
            bx = (canvas_w - bw) // 2
            by = 24

            raw_banner = Image.open(local_banner_img).convert("RGBA")
            rw, rh = raw_banner.size

            # Object-cover calculation (crop center & scale)
            scale = max(bw / rw, bh / rh)
            new_w = int(rw * scale)
            new_h = int(rh * scale)
            resized_banner = raw_banner.resize((new_w, new_h), Image.Resampling.LANCZOS)

            # Crop ke ukuran tepat bw x bh (center crop)
            crop_x = (new_w - bw) // 2
            crop_y = (new_h - bh) // 2
            banner = resized_banner.crop((crop_x, crop_y, crop_x + bw, crop_y + bh))

            # Shadow effect di belakang banner
            shadow_banner = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
            sb_draw = ImageDraw.Draw(shadow_banner)
            sb_draw.rounded_rectangle((bx, by + 4, bx + bw, by + bh + 4), radius=22, fill=(0, 0, 0, 140))
            shadow_banner = shadow_banner.filter(ImageFilter.GaussianBlur(radius=10))
            overlay = Image.alpha_composite(overlay, shadow_banner)

            # Mask rounded corner untuk banner
            b_mask = Image.new("L", (bw, bh), 0)
            b_draw = ImageDraw.Draw(b_mask)
            b_draw.rounded_rectangle((0, 0, bw, bh), radius=20, fill=255)

            overlay.paste(banner, (bx, by), b_mask)

            # Border halus semi-transparan
            draw_banner_border = ImageDraw.Draw(overlay)
            draw_banner_border.rounded_rectangle(
                (bx, by, bx + bw, by + bh),
                radius=20,
                outline=(255, 255, 255, 180),
                width=2,
            )
            print(f"[OVERLAY] Top banner rendered (cover crop): pos=({bx}, {by}), size={bw}x{bh}")
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
            fill=(0, 0, 0, 95),
        )
        shadow_card = shadow_card.filter(ImageFilter.GaussianBlur(radius=12))
        overlay = Image.alpha_composite(overlay, shadow_card)

        card_canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
        card_draw = ImageDraw.Draw(card_canvas)
        card_draw.rounded_rectangle(
            (card_x, card_y, card_x + card_w, card_y + card_h),
            radius=radius,
            fill=(255, 255, 255, 250),
            outline=(241, 245, 249, 255),
            width=2,
        )
        overlay = Image.alpha_composite(overlay, card_canvas)
        draw = ImageDraw.Draw(overlay)

        thumb_size = 106
        thumb_x = card_x + 18
        thumb_y = card_y + 16

        if local_product_img and os.path.exists(local_product_img):
            try:
                p_img = Image.open(local_product_img).convert("RGBA")
                p_img = p_img.resize((thumb_size, thumb_size), Image.Resampling.LANCZOS)

                p_mask = Image.new("L", (thumb_size, thumb_size), 0)
                pm_draw = ImageDraw.Draw(p_mask)
                pm_draw.rounded_rectangle((0, 0, thumb_size, thumb_size), radius=18, fill=255)

                overlay.paste(p_img, (thumb_x, thumb_y), p_mask)
                draw.rounded_rectangle(
                    (thumb_x, thumb_y, thumb_x + thumb_size, thumb_y + thumb_size),
                    radius=18,
                    outline=(226, 232, 240, 255),
                    width=2,
                )
            except Exception as e:
                print(f"[OVERLAY ERROR] Gagal rendering thumbnail: {e}")

        text_x = thumb_x + thumb_size + 20
        font_name, font_price, font_strike = resolve_fonts()

        if product_name:
            clean_name = product_name.strip()
            if len(clean_name) > 28:
                clean_name = clean_name[:26] + "…"
            draw.text((text_x, card_y + 24), clean_name, font=font_name, fill=(15, 23, 42, 255))

        raw_price = 0
        if product_price:
            digits = re.sub(r"[^0-9]", "", str(product_price))
            if digits:
                raw_price = int(digits)

        if raw_price > 0:
            current_price_str = f"Rp{raw_price:,}".replace(",", ".")
            auto_orig_price = int(math.ceil((raw_price * 1.35) / 5000.0) * 5000)
            strikethrough_str = f"Rp{auto_orig_price:,}".replace(",", ".")

            draw.text((text_x, card_y + 68), current_price_str, font=font_price, fill=(225, 29, 72, 255))

            bbox = font_price.getbbox(current_price_str)
            price_w = bbox[2] - bbox[0] if bbox else 150

            strike_x = text_x + price_w + 16
            strike_y = card_y + 78

            draw.text((strike_x, strike_y), strikethrough_str, font=font_strike, fill=(148, 163, 184, 255))

            s_bbox = font_strike.getbbox(strikethrough_str)
            strike_w = s_bbox[2] - s_bbox[0] if s_bbox else 80
            line_y = strike_y + 11
            draw.line((strike_x - 2, line_y, strike_x + strike_w + 2, line_y), fill=(148, 163, 184, 255), width=2)
        elif product_price:
            draw.text((text_x, card_y + 68), str(product_price), font=font_price, fill=(225, 29, 72, 255))

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

    if not local_banner_img or not os.path.exists(local_banner_img):
        for candidate in [
            os.path.join(tmp_dir, "banner_promo.png"),
            os.path.join(output_folder, "banner_promo.png"),
            os.path.join(output_folder, "banner_atas_tengah.png"),
            "/workspace/ai_live_worker/assets/banner_atas_tengah.png",
            "/workspace/live-streaming-ai/frontend/public/banner_atas_tengah.png",
            os.path.join(os.path.dirname(__file__), "../frontend/public/banner_atas_tengah.png"),
            os.path.join(os.path.dirname(__file__), "assets/banner_atas_tengah.png"),
            os.path.join(os.getcwd(), "frontend/public/banner_atas_tengah.png"),
        ]:
            if os.path.isfile(candidate):
                local_banner_img = candidate
                print(f"[OVERLAY] Banner fallback ditemukan: {local_banner_img}")
                break

    resolved_name = (product_name or "").strip()
    resolved_price = (product_price or "").strip()
    if not resolved_name and not resolved_price and not local_product_img:
        resolved_name = "SPECIAL LIVE PROMO"
        resolved_price = "99000"

    return render_pil_overlay(
        tmp_dir=tmp_dir,
        output_folder=output_folder,
        local_banner_img=local_banner_img,
        local_product_img=local_product_img,
        product_name=resolved_name,
        product_price=resolved_price,
    )
