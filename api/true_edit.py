"""
Vercel Serverless Function: TrueEdit Engine for PDF
Powered by PyMuPDF (MuPDF C++ engine)

Features:
- True Stream Redaction (removes text glyph operators from PDF stream without opaque patches)
- Background images and vector graphics behind text are preserved 100%
- Native Vector Text Injection (crisp, searchable, selectable text)
"""

from http.server import BaseHTTPRequestHandler
import json
import base64
import re
import pymupdf


def parse_color(c):
    """Parse color into (r, g, b) float tuple in [0.0, 1.0]."""
    if isinstance(c, (list, tuple)) and len(c) >= 3:
        return (float(c[0]), float(c[1]), float(c[2]))
    if isinstance(c, str):
        c = c.strip()
        if c.startswith('#') and len(c) in (7, 4):
            if len(c) == 4:
                c = '#' + ''.join([ch * 2 for ch in c[1:]])
            try:
                r = int(c[1:3], 16) / 255.0
                g = int(c[3:5], 16) / 255.0
                b = int(c[5:7], 16) / 255.0
                return (r, g, b)
            except Exception:
                pass
        # rgb(r, g, b) format
        rgb_match = re.match(r'rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)', c, re.IGNORECASE)
        if rgb_match:
            try:
                r = int(rgb_match.group(1)) / 255.0
                g = int(rgb_match.group(2)) / 255.0
                b = int(rgb_match.group(3)) / 255.0
                return (r, g, b)
            except Exception:
                pass
    return (0.0, 0.0, 0.0)


def get_standard_font(family_name, is_bold=False, is_italic=False):
    """Map web font family to PyMuPDF standard 14 font codes."""
    fam = (family_name or '').lower()
    if 'times' in fam or 'georgia' in fam or ('serif' in fam and 'sans' not in fam):
        if is_bold and is_italic:
            return 'tibi'
        elif is_bold:
            return 'tibo'
        elif is_italic:
            return 'tiit'
        return 'tiro'
    elif 'courier' in fam or 'mono' in fam:
        if is_bold and is_italic:
            return 'cobi'
        elif is_bold:
            return 'cobo'
        elif is_italic:
            return 'coit'
        return 'cour'
    else:
        if is_bold and is_italic:
            return 'hebi'
        elif is_bold:
            return 'hebo'
        elif is_italic:
            return 'heit'
        return 'helv'


def process_true_edit(pdf_bytes, edits):
    """
    Apply TrueEdit text redaction and injection using PyMuPDF.
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")

    for edit in edits:
        page_idx = int(edit.get("page", 0))
        if page_idx < 0 or page_idx >= len(doc):
            continue

        page = doc[page_idx]
        rect_raw = edit.get("rect")
        if not rect_raw or len(rect_raw) < 4:
            continue

        rect = pymupdf.Rect(rect_raw[0], rect_raw[1], rect_raw[2], rect_raw[3])
        # Ensure rect is valid (x0 < x1, y0 < y1)
        rect.normalize()

        # 1. True Redaction: Remove glyph stream operators
        # If useWhiteout is True, fill with white.
        # Otherwise fill=None removes the text transparently, keeping background image!
        fill_color = (1.0, 1.0, 1.0) if edit.get("useWhiteout", False) else None

        page.add_redact_annot(rect, fill=fill_color)
        # Apply redactions preserving any background images
        page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE)

        # 2. Insert new text at target coordinates as native vector text
        new_text = str(edit.get("newText", ""))
        if new_text.strip():
            target_raw = edit.get("targetRect", rect_raw)
            if target_raw and len(target_raw) >= 4:
                target_rect = pymupdf.Rect(target_raw[0], target_raw[1], target_raw[2], target_raw[3])
                target_rect.normalize()
            else:
                target_rect = rect

            font_name = get_standard_font(
                edit.get("fontFamily", "helv"),
                is_bold=bool(edit.get("bold", False)),
                is_italic=bool(edit.get("italic", False))
            )
            font_size = float(edit.get("fontSize", 14))
            color = parse_color(edit.get("color", "#0f172a"))

            # Calculate precise baseline for single or multi-line text
            lines = new_text.split('\n')
            line_height = font_size * 1.25
            baseline_y0 = target_rect.y0 + (font_size * 0.88)

            for i, line in enumerate(lines):
                page.insert_text(
                    pymupdf.Point(target_rect.x0, baseline_y0 + (i * line_height)),
                    line,
                    fontsize=font_size,
                    fontname=font_name,
                    color=color
                )

    return doc.tobytes(garbage=3, deflate=True)


class handler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        # Health check endpoint
        res = {
            "status": "online",
            "service": "PDF Flow PRO - TrueEdit Engine",
            "engine": "PyMuPDF " + pymupdf.__version__,
            "capabilities": ["true_redaction", "vector_injection", "background_preservation"]
        }
        body = json.dumps(res).encode('utf-8')
        self.send_response(200)
        self._send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self._send_error_json(400, "Request body is empty.")
                return

            post_data = self.rfile.read(content_length)
            content_type = self.headers.get('Content-Type', '')

            pdf_bytes = None
            edits = []

            # Handle JSON body (recommended)
            if 'application/json' in content_type:
                data = json.loads(post_data.decode('utf-8'))
                raw_b64 = data.get('pdfBase64', '')
                if not raw_b64:
                    self._send_error_json(400, "Missing 'pdfBase64' field in request.")
                    return
                # Remove data url prefix if present
                if ',' in raw_b64:
                    raw_b64 = raw_b64.split(',', 1)[1]
                pdf_bytes = base64.b64decode(raw_b64)
                edits = data.get('edits', [])
            else:
                self._send_error_json(400, "Unsupported content-type. Please use application/json.")
                return

            if not pdf_bytes or len(pdf_bytes) < 10:
                self._send_error_json(400, "Invalid PDF data provided.")
                return

            # Process TrueEdit
            output_bytes = process_true_edit(pdf_bytes, edits)

            # Return modified PDF bytes
            self.send_response(200)
            self._send_cors_headers()
            self.send_header('Content-Type', 'application/pdf')
            self.send_header('Content-Disposition', 'attachment; filename="true_edited.pdf"')
            self.send_header('Content-Length', str(len(output_bytes)))
            self.end_headers()
            self.wfile.write(output_bytes)

        except Exception as e:
            import traceback
            traceback.print_exc()
            self._send_error_json(500, f"TrueEdit processing error: {str(e)}")

    def _send_error_json(self, code, msg):
        res = {"error": msg, "code": code}
        body = json.dumps(res).encode('utf-8')
        self.send_response(code)
        self._send_cors_headers()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
