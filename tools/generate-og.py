from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "og-image.png"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = (
        ["/System/Library/Fonts/Supplemental/Arial Bold.ttf"]
        if bold
        else ["/System/Library/Fonts/Supplemental/Arial.ttf"]
    )
    names.append("/System/Library/Fonts/Helvetica.ttc")
    for name in names:
        path = Path(name)
        if path.exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default(size=size)


def centered(draw: ImageDraw.ImageDraw, text: str, y: int, selected_font, fill: str) -> None:
    box = draw.textbbox((0, 0), text, font=selected_font)
    draw.text(((1200 - (box[2] - box[0])) / 2, y), text, font=selected_font, fill=fill)


def main() -> None:
    image = Image.new("RGB", (1200, 630), "#081426")
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((558, 64, 642, 72), radius=4, fill="#D2AE5A")
    draw.rounded_rectangle((558, 78, 622, 85), radius=3, fill="#D2AE5A")
    draw.rounded_rectangle((558, 91, 602, 97), radius=3, fill="#D2AE5A")
    centered(draw, "THREE STRIPES DIGITAL", 120, font(35, True), "#D2AE5A")
    centered(draw, "FREE ORGANIC RANK-BOOST TEST", 194, font(54, True), "#F8FAFC")
    centered(draw, "FOR LAW FIRMS", 260, font(54, True), "#F8FAFC")

    draw.rounded_rectangle((350, 365, 850, 425), radius=30, fill="#D2AE5A")
    centered(draw, "NO CHARGE IF YOU QUALIFY", 379, font(27, True), "#081426")
    centered(draw, "Positions 11–50 · no card · no site access", 462, font(27), "#AAB8CB")
    centered(draw, "Results and timing vary", 505, font(23), "#AAB8CB")
    centered(draw, "threestripesdigital.com/rank-boost/law-firms", 565, font(23, True), "#F8FAFC")

    image.save(OUTPUT, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
