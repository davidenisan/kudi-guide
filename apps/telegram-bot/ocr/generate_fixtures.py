"""
Generates the synthetic receipt fixtures used for extraction regression checks.

These are not real receipts — no real names, accounts or references appear
anywhere in this repo (testset/ is gitignored for exactly that reason: real
receipts belong to real people). These are drawn from scratch to reproduce the
*shapes* that have actually broken extraction: a label centred against a
multi-line value block, two labels sharing a value column with little vertical
gap, an ISO date, a reference and a session id both present, a value column
value that itself looks like a plausible reference (a bare digit run).

Run from apps/telegram-bot: ocr/.venv/bin/python ocr/generate_fixtures.py
Then check: npm run test:extract -- ocr/fixtures
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent / "fixtures"
OUT.mkdir(exist_ok=True)


def font(size, bold=False):
    path = (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
        if bold
        else "/System/Library/Fonts/Supplemental/Arial.ttf"
    )
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def labelled_receipt(name, title, rows, width=780, footer=True):
    """
    A label-left / value-right receipt: rows are (label, [value lines]).
    The label is vertically centred against its value block, same as every
    bank in this family (Access, and several fintechs) actually renders one.
    """
    height = 260 + sum(max(len(v), 1) * 34 + 20 for _, v in rows) + (140 if footer else 40)
    img = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(img)
    d.text((60, 60), title, font=font(28, True), fill="#1B4F9C")
    d.text((60, 105), "Transaction Receipt", font=font(20, True), fill="#333")
    d.text((60, 135), "Generated from AccessMore on 28/08/26 12:51:52", font=font(11), fill="#666")

    y = 170
    label_x, value_x = 60, 330
    for label, values in rows:
        block_h = max(len(values), 1) * 34
        d.text((label_x, y + block_h // 2 - 10), label, font=font(14, True), fill="#E87722")
        for i, v in enumerate(values):
            d.text((value_x, y + i * 34), v, font=font(14), fill="#222")
        y += block_h + 20
        d.line([60, y - 8, width - 60, y - 8], fill="#eee")

    if footer:
        d.text((60, y + 20), "Thank you for banking with us.", font=font(11), fill="#666")

    img.save(OUT / f"{name}.png")
    print(f"wrote {name}.png")


# --- Access-style: label centred against value, ISO date, reference AND
# session id both present, a bare-digit account number sitting in the same
# value column as the reference. This is the exact shape that produced two
# real bugs: the beneficiary's account number returned as the reference, and
# the recipient's bank returned instead of the issuer's. -------------------
labelled_receipt(
    "access_bill_payment",
    "access",
    [
        ("Transaction Amount", ["N3,500"]),
        ("Transaction Type", ["BILL PAYMENT"]),
        ("Transaction Date", ["2026-08-28 12:51:46"]),
        ("Sender", []),
        ("Beneficiary", ["ABUJA DISCO", "45059749064"]),
        ("Remark", ["MOBILE BILLS PYMT/ ABUJA DISCO", "/45059749064"]),
        ("Transaction Reference", ["NXG271860421083828900"]),
        ("Session Id", []),
        ("Transaction Status", ["Successful"]),
    ],
)

labelled_receipt(
    "access_transfer",
    "access",
    [
        ("Transaction Amount", ["N10,000"]),
        ("Transaction Type", ["INTER-BANK"]),
        ("Transaction Date", ["2026-08-18 14:11:48"]),
        ("Sender", ["FINNEY SAMUEL OSAJERE"]),
        ("Beneficiary", ["DGMC SOLUTIONS LTD -", "8134576903", "MONIEPOINT MICROFINANCE BANK"]),
        ("Remark", []),
        ("Transaction Reference", ["NXG000014260818141149252148982360"]),
        ("Session Id", ["000014260818141149252148982360"]),
        ("Transaction Status", ["Successful"]),
    ],
)


def compact_receipt(name, header, rows, width=520, height=760, header_color="#5B2C87"):
    """A single-column app-style receipt — the OPay/Kuda/GTBank/PalmPay shape:
    a coloured banner, then label above value, stacked."""
    img = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, width, 90], fill=header_color)
    d.text((30, 32), header, font=font(30, True), fill="white")

    y = 130
    for label, value in rows:
        d.text((30, y), label, font=font(15), fill="#777")
        d.text((30, y + 25), value, font=font(19, True), fill="#111")
        y += 80

    img.save(OUT / f"{name}.png")
    print(f"wrote {name}.png")


compact_receipt(
    "opay_transfer",
    "OPay",
    [
        ("Amount", "N 12,500.00"),
        ("Recipient", "JUMIA NIGERIA LTD"),
        ("Transaction Type", "Transfer"),
        ("Date", "25 Aug 2026, 10:42 AM"),
        ("Transaction Reference", "OP2608251042XYZ9931"),
        ("Sender", "DANIEL O"),
    ],
    header_color="#5B2C87",
)

compact_receipt(
    "kuda_airtime",
    "Kuda",
    [
        ("Amount", "- N 3,200.00"),
        ("Recipient", "MTN VTU AIRTIME"),
        ("Type", "Airtime"),
        ("Date", "23 Aug 2026, 09:12 AM"),
        ("Reference", "KUDA-TRX-88213094"),
    ],
    header_color="#40196D",
)

compact_receipt(
    "gtbank_pos",
    "GTBank",
    [
        ("Amount", "NGN 45,000.00"),
        ("Merchant", "SHOPRITE NIGERIA"),
        ("Transaction Type", "POS Purchase"),
        ("Date", "24 Aug 2026, 14:05"),
        ("Session ID", "099876543210987654321098"),
    ],
    header_color="#FF6600",
)

compact_receipt(
    "palmpay_bills",
    "PalmPay",
    [
        ("Amount", "N5,000.00"),
        ("Biller", "IKEDC PREPAID"),
        ("Transaction Type", "Bill Payment"),
        ("Date", "22 Aug 2026, 08:30"),
        ("Reference", "PP-2026-0822-9917"),
    ],
    header_color="#6C2EB9",
)

# --- junk: not a receipt at all. Must never be reported as one. -----------
img = Image.new("RGB", (400, 300), "white")
d = ImageDraw.Draw(img)
d.text((20, 20), "Shopping list", font=font(20, True), fill="#111")
for i, item in enumerate(["rice, beans", "milk", "call mum"]):
    d.text((20, 60 + i * 30), f"- {item}", font=font(16), fill="#333")
img.save(OUT / "not_a_receipt.png")
print("wrote not_a_receipt.png")

img = Image.new("RGB", (300, 300), "#c9a888")
img.save(OUT / "blank_photo.png")
print("wrote blank_photo.png")

print(f"\n{len(list(OUT.glob('*.png')))} fixtures in {OUT}")
