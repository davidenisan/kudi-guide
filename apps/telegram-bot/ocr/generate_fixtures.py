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


def opay_receipt_page(name, amount, recipient, recipient_sub, sender, sender_sub, txn_no, session_id, status_date):
    """
    The real OPay app export: a big status banner with an ordinal date above
    everything, then Recipient Details / Sender Details as two-line blocks —
    bold name, grey account line underneath — with no field labelled "Type" at
    all. This shape produced two real extraction bugs: the ordinal ("31st")
    broke date parsing outright, and with "Sender Details" unrecognised as a
    label its whole block (plus the "Successful" banner above everything) fell
    inside "Recipient Details"'s own search window, so the banner — being
    topmost — was returned as the merchant.
    """
    width, height = 620, 560
    img = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(img)

    d.text((width // 2, 40), amount, font=font(26, True), fill="#0B8F5A", anchor="mm")
    d.text((width // 2, 75), "Successful", font=font(18, True), fill="#222", anchor="mm")
    d.text((width // 2, 98), status_date, font=font(11), fill="#888", anchor="mm")

    y = 140

    def row(label, first, second, y):
        d.text((40, y), label, font=font(12), fill="#999")
        d.text((width - 40, y), first, font=font(14, True), fill="#111", anchor="ra")
        d.text((width - 40, y + 20), second, font=font(11), fill="#666", anchor="ra")
        return y + 60

    y = row("Recipient Details", recipient, recipient_sub, y)
    y = row("Sender Details", sender, sender_sub, y)
    d.text((40, y), "Transaction No.", font=font(12), fill="#999")
    d.text((width - 40, y), txn_no, font=font(12), fill="#111", anchor="ra")
    y += 40
    d.text((40, y), "Session ID", font=font(12), fill="#999")
    d.text((width - 40, y), session_id, font=font(12), fill="#111", anchor="ra")
    y += 50

    d.text((40, y), "Enjoy a better life with OPay. Get free transfers, withdrawals, bill payments,", font=font(9), fill="#aaa")
    d.text((40, y + 15), "instant loans, and good annual interest on your savings.", font=font(9), fill="#aaa")

    img.save(OUT / f"{name}.png")
    print(f"wrote {name}.png")


opay_receipt_page(
    "opay_receipt_page",
    "N3,000.00",
    "RAYMOND OSAS",
    "POCKETAPP | 7876588494",
    "TOLUWALOPE JUDAH AKAPO",
    "OPay | 815****960",
    "2608310201004767051 83299",
    "100004260831133618169865077046",
    "Aug 31st, 2026 14:36:12",
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

def palmpay_receipt_card(name, amount, status_line, status_date, recipient, recipient_sub,
                          sender, sender_sub, txn_type, purpose, txn_id):
    """
    PalmPay's own app card: a bare wordmark top-left above everything else,
    a status line as "Successful Transaction" — reversed from Access's own
    "Transaction Successful" — then Recipient/Sender stacked label-above-value,
    then a "Transaction Info" section that switches to label-left/value-right.

    This shape produced two real bugs before the fixes here: the bare
    "PalmPay" wordmark, being literally the first text on the page and
    genuinely name-shaped, was returned as the merchant — the app that made
    the receipt is never who the money went to. And the reversed status
    banner slipped past a check written for "Transaction Successful" only.
    """
    width, height = 620, 800
    img = Image.new("RGB", (width, height), "white")
    d = ImageDraw.Draw(img)

    d.text((40, 30), "PalmPay", font=font(20, True), fill="#6C2EB9")
    d.text((width // 2, 90), amount, font=font(28, True), fill="#6C2EB9", anchor="mm")
    d.text((width // 2, 125), status_line, font=font(14, True), fill="#333", anchor="mm")
    d.text((width // 2, 148), status_date, font=font(11), fill="#888", anchor="mm")

    y = 190

    def stacked(label, first, second, y):
        d.text((40, y), label, font=font(12), fill="#999")
        d.text((40, y + 22), first, font=font(15, True), fill="#111")
        d.text((40, y + 44), second, font=font(11), fill="#666")
        return y + 80

    y = stacked("Recipient:", recipient, recipient_sub, y)
    y = stacked("Sender:", sender, sender_sub, y)

    y += 15
    d.line([40, y, width - 40, y], fill="#eee")
    y += 20
    d.text((40, y), "Transaction Info", font=font(14, True), fill="#333")
    y += 40

    def table_row(label, value, y):
        d.text((40, y), label, font=font(12), fill="#999")
        d.text((width - 40, y), value, font=font(13), fill="#111", anchor="ra")
        return y + 36

    y = table_row("Transaction Type", txn_type, y)
    y = table_row("What's it for", purpose, y)
    y = table_row("Transaction ID", txn_id, y)

    y += 30
    d.text((40, y), "Enjoy Seamless and Unlimited Free Transfers to All Banks.", font=font(9), fill="#aaa")
    d.text((40, y + 14), "Get cashbacks in Airtime & data top-up!", font=font(9), fill="#aaa")
    d.text((40, y + 28), "Enjoy all at PalmPay!", font=font(9), fill="#aaa")

    img.save(OUT / f"{name}.png")
    print(f"wrote {name}.png")


palmpay_receipt_card(
    "palmpay_receipt_card",
    "N4,000.00",
    "Successful Transaction",
    "17:25, Aug 30, 2026",
    "RAYMOND OSAS",
    "POCKETAPP | 7876588494",
    "OLUWAFEMI ODUSANYA",
    "PalmPay | 810 *** 1455",
    "Money Transfer - MMO",
    "House due",
    "033A0DOC3600",
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
