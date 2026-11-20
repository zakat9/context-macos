#!/usr/bin/env python3
"""Build the fictional demo and test sources. Everything here is invented: people, companies, figures.
Run once by the author; the generated files are checked in under demo/fixtures and tests/fixtures."""
import base64, datetime, io, os, quopri, re, zipfile
from openpyxl import Workbook
from openpyxl.styles import Font

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, 'demo', 'fixtures'); TEST = os.path.join(ROOT, 'tests', 'fixtures')
os.makedirs(DEMO, exist_ok=True); os.makedirs(TEST, exist_ok=True)

def write(path, data):
    with open(path, 'wb') as f: f.write(data if isinstance(data, bytes) else data.encode('utf-8'))

# ---- email 1: quoted-printable, UTF-8 ----
body1 = """Hi Mina,

Here is the revised quote for the Pine Ridge housing mold — it replaces the one from last week.

- 2-cavity mold, P20 steel: USD 48,500
- Lead time: 6 weeks from purchase order
- Quote valid until Nov 30, 2026

Switching to H13 steel would add USD 3,200.

Best,
Dana Okafor
Harborline Tooling
"""
qp = quopri.encodestring(body1.replace('\n', '\r\n').encode('utf-8')).decode('ascii')
eml1 = ("From: Dana Okafor <dana.okafor@harborline-tooling.example>\r\n"
        "To: Mina Seo <mina.seo@northfield-devices.example>\r\n"
        "Subject: =?UTF-8?Q?Revised_tooling_quote_=E2=80=94_Pine_Ridge_housing?=\r\n"
        "Date: Tue, 10 Nov 2026 09:12:00 +0900\r\n"
        "Message-ID: <20261110.0912.rq2@harborline-tooling.example>\r\n"
        "MIME-Version: 1.0\r\n"
        "Content-Type: text/plain; charset=\"UTF-8\"\r\n"
        "Content-Transfer-Encoding: quoted-printable\r\n\r\n" + qp)
write(os.path.join(DEMO, 'Revised tooling quote - Pine Ridge housing.eml'), eml1)

# ---- email 2: multipart/mixed (alternative base64 + an attachment that is listed, never read) ----
body2 = """Mina,

The approved cap for Pine Ridge tooling is USD 50,000.
Anything above the cap needs a second sign-off from me before Nov 20.

Jonas Reyes
Finance, Northfield Devices
"""
html2 = "<html><body><p>Mina,</p><p>The approved cap for Pine Ridge tooling is <b>USD 50,000</b>.</p></body></html>"
b64 = lambda s: '\r\n'.join(re.findall('.{1,76}', base64.b64encode(s.encode('utf-8')).decode('ascii')))
eml2 = ("From: Jonas Reyes <jonas.reyes@northfield-devices.example>\r\n"
        "To: Mina Seo <mina.seo@northfield-devices.example>\r\n"
        "Subject: Tooling budget cap for Pine Ridge\r\n"
        "Date: Tue, 17 Nov 2026 14:05:00 +0900\r\n"
        "Message-ID: <cap-20261117-1405@northfield-devices.example>\r\n"
        "MIME-Version: 1.0\r\n"
        "Content-Type: multipart/mixed; boundary=\"OUTER-7f3a\"\r\n\r\n"
        "--OUTER-7f3a\r\nContent-Type: multipart/alternative; boundary=\"ALT-91c2\"\r\n\r\n"
        "--ALT-91c2\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" + b64(body2) + "\r\n"
        "--ALT-91c2\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n" + html2 + "\r\n"
        "--ALT-91c2--\r\n"
        "--OUTER-7f3a\r\nContent-Type: application/pdf; name=\"cap-memo.pdf\"\r\nContent-Disposition: attachment; filename=\"cap-memo.pdf\"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n"
        "--OUTER-7f3a--\r\n")
write(os.path.join(DEMO, 'Tooling budget cap for Pine Ridge.eml'), eml2)

# ---- note ----
note = """Supplier call notes: Harborline (Dana Okafor)

- The 48.5k quote assumes P20 steel and our standard texture.
- H13 only pays off above 500k shots; our forecast is 300k.
- She can hold the price until Nov 30 if we confirm the steel by Nov 20.

Open: who signs off if we go over the cap?
"""
write(os.path.join(DEMO, 'Supplier call notes - Harborline.md'), note)

# ---- workbook helpers ----
def cached(xlsx_bytes, values):
    """openpyxl does not store formula results; add them the way a spreadsheet app would on save."""
    src = zipfile.ZipFile(io.BytesIO(xlsx_bytes)); out = io.BytesIO(); dst = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
    for item in src.infolist():
        data = src.read(item.filename)
        if item.filename in values:
            x = data.decode('utf-8')
            for ref, val in values[item.filename].items():
                x, n = re.subn(r'(<c r="%s"[^>]*>)(<f>[^<]*</f>)<v\s*/>' % ref, r'\g<1>\g<2><v>%s</v>' % val, x)
                if n == 0: x, n = re.subn(r'(<c r="%s"[^>]*>)(<f>[^<]*</f>)<v></v>' % ref, r'\g<1>\g<2><v>%s</v>' % val, x)
                assert n == 1, (item.filename, ref, x[:400])
            data = x.encode('utf-8')
        dst.writestr(item, data)
    dst.close(); return out.getvalue()

def save(wb, modified):
    """Save, then set the document's own "modified" date (openpyxl stamps the current time on save)."""
    b = io.BytesIO(); wb.save(b)
    src = zipfile.ZipFile(io.BytesIO(b.getvalue())); out = io.BytesIO(); dst = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
    for item in src.infolist():
        data = src.read(item.filename)
        if item.filename == 'docProps/core.xml':
            x, n = re.subn(r'(<dcterms:modified[^>]*>)[^<]*(</dcterms:modified>)', r'\g<1>%s\g<2>' % modified, data.decode('utf-8'))
            assert n == 1; data = x.encode('utf-8')
        dst.writestr(item, data)
    dst.close(); return out.getvalue()

# ---- demo workbook ----
wb = Workbook(); q = wb.active; q.title = 'Quotes'
q.append(['Vendor', 'Item', 'Quote (USD)', 'Quote date', 'Note'])
for c in q[1]: c.font = Font(bold=True)
q.append(['Harborline Tooling', '2-cavity mold, P20 steel', 48500, datetime.date(2026, 11, 10), 'Revised quote'])
q.append(['Harborline Tooling', 'H13 steel upgrade', 3200, datetime.date(2026, 11, 10), 'Optional'])
q.append(['Kestrel Moldworks', '2-cavity mold, P20 steel', 51200, datetime.date(2026, 11, 6), 'Competing quote'])
s = wb.create_sheet('Summary')
s.append(['Budget cap (USD)', 50000]); s.append(['Selected quote (USD)', '=Quotes!C2']); s.append(['Headroom (USD)', '=B1-B2'])
wb.properties.creator = 'Mina Seo'; wb.properties.lastModifiedBy = 'Mina Seo'
wb.properties.created = datetime.datetime(2026, 11, 3, 2, 0, 0)
write(os.path.join(DEMO, 'tooling-cost-model.xlsx'), cached(save(wb, '2026-11-18T07:40:00Z'), {'xl/worksheets/sheet2.xml': {'B2': 48500, 'B3': 1500}}))

# ---- things that cannot be read: a scan (no reader) and a list that gets deleted in the demo ----
write(os.path.join(DEMO, 'first-quote-scan.pdf'), b'%PDF-1.4\n% fictional placeholder: a scanned first quote, no text layer\n%%EOF\n')
write(os.path.join(DEMO, 'vendor-shortlist.csv'), 'Vendor,Region\nHarborline Tooling,Incheon\nKestrel Moldworks,Busan\n')

# ---- acceptance test: the same workbook saved with 900, then overwritten with 820 ----
def budget(value, modified):
    w = Workbook(); a = w.active; a.title = 'Summary'
    a.append(['Line', 'Monthly amount (USD)']); a.append(['Mold maintenance', value]); a.append(['Checked by', 'Mina Seo'])
    w.properties.creator = 'Mina Seo'; w.properties.created = datetime.datetime(2026, 11, 2, 1, 0, 0)
    return save(w, modified)
write(os.path.join(TEST, 'maintenance-900.xlsx'), budget(900, '2026-11-09T03:00:00Z'))
write(os.path.join(TEST, 'maintenance-820.xlsx'), budget(820, '2026-11-16T05:30:00Z'))
print('fixtures written')
