#!/usr/bin/env python3
"""
PDF多功能处理工具箱
支持：压缩、转Word、提取图片、合并、拆分、提取文字、转图片、旋转页面
"""

import os
import uuid
import zipfile
from datetime import datetime, timedelta
from io import BytesIO
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file
from werkzeug.utils import secure_filename
import fitz
from pdf2docx import Converter

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

FILE_EXPIRY = timedelta(hours=2)
MAX_FILE_SIZE = 300 * 1024 * 1024  # 300MB

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_FILE_SIZE


@app.errorhandler(413)
def request_too_large(e):
    return jsonify({"error": f"文件过大，单个/批量上传不能超过 {MAX_FILE_SIZE // 1024 // 1024}MB"}), 413


def cleanup_old_files():
    now = datetime.now()
    for folder in [UPLOAD_DIR, OUTPUT_DIR]:
        for f in folder.iterdir():
            if f.is_file():
                mtime = datetime.fromtimestamp(f.stat().st_mtime)
                if now - mtime > FILE_EXPIRY:
                    try:
                        f.unlink()
                    except Exception:
                        pass


def format_size(size_bytes):
    for unit in ["B", "KB", "MB", "GB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def get_pdf_info(filepath):
    try:
        doc = fitz.open(filepath)
        pages = doc.page_count
        size = os.path.getsize(filepath)
        doc.close()
        return {"pages": pages, "size": size, "size_formatted": format_size(size)}
    except Exception as e:
        return {"pages": 0, "size": 0, "error": str(e)}


# ==================== 页面路由 ====================


@app.route("/")
def index():
    cleanup_old_files()
    return render_template("index.html")


# ==================== 上传 ====================


@app.route("/api/upload", methods=["POST"])
def upload():
    if "files" not in request.files:
        return jsonify({"error": "没有上传文件"}), 400

    files = request.files.getlist("files")
    results = []

    for file in files:
        if not file.filename:
            continue
        if not file.filename.lower().endswith(".pdf"):
            results.append({"name": file.filename, "error": "仅支持PDF文件"})
            continue

        display_name = file.filename
        file_id = str(uuid.uuid4())[:12]
        ext = Path(file.filename).suffix.lower()
        save_name = f"{file_id}{ext}"
        save_path = UPLOAD_DIR / save_name

        file.save(str(save_path))

        info = get_pdf_info(str(save_path))

        if info.get("error"):
            results.append(
                {
                    "id": file_id,
                    "name": display_name,
                    "filename": save_name,
                    "error": info["error"],
                }
            )
        else:
            results.append(
                {
                    "id": file_id,
                    "name": display_name,
                    "filename": save_name,
                    "size": info["size"],
                    "size_formatted": info["size_formatted"],
                    "pages": info["pages"],
                }
            )

    return jsonify({"files": results})


# ==================== PDF 压缩 ====================


@app.route("/api/compress", methods=["POST"])
def compress_pdf():
    data = request.json
    filename = data.get("filename")

    if not filename:
        return jsonify({"error": "未指定文件"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在，请重新上传"}), 404

    output_name = f"compressed_{filename}"
    output_path = OUTPUT_DIR / output_name

    try:
        doc = fitz.open(str(input_path))
        doc.save(str(output_path), garbage=4, deflate=True, clean=True)
        doc.close()

        orig_size = os.path.getsize(str(input_path))
        new_size = os.path.getsize(str(output_path))
        ratio = round((1 - new_size / orig_size) * 100, 1) if orig_size > 0 else 0

        return jsonify(
            {
                "success": True,
                "filename": output_name,
                "original_size": orig_size,
                "original_size_formatted": format_size(orig_size),
                "compressed_size": new_size,
                "compressed_size_formatted": format_size(new_size),
                "ratio": ratio,
            }
        )
    except Exception as e:
        return jsonify({"error": f"压缩失败: {str(e)}"}), 500


# ==================== PDF 转 Word ====================


@app.route("/api/to-word", methods=["POST"])
def pdf_to_word():
    data = request.json
    filename = data.get("filename")

    if not filename:
        return jsonify({"error": "未指定文件"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在，请重新上传"}), 404

    base_stem = secure_filename(Path(filename).stem) or "document"
    output_name = f"{base_stem}.docx"
    output_path = OUTPUT_DIR / output_name

    try:
        cv = Converter(str(input_path))
        cv.convert(str(output_path))
        cv.close()

        output_size = os.path.getsize(str(output_path))

        return jsonify(
            {
                "success": True,
                "filename": output_name,
                "size": output_size,
                "size_formatted": format_size(output_size),
            }
        )
    except Exception as e:
        return jsonify({"error": f"转换失败: {str(e)}"}), 500


# ==================== 提取图片 ====================


@app.route("/api/extract-images", methods=["POST"])
def extract_images():
    data = request.json
    filename = data.get("filename")

    if not filename:
        return jsonify({"error": "未指定文件"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在，请重新上传"}), 404

    base_stem = secure_filename(Path(filename).stem) or "document"
    zip_name = f"{base_stem}_images.zip"
    zip_path = OUTPUT_DIR / zip_name

    try:
        doc = fitz.open(str(input_path))
        image_count = 0

        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
            for page_num in range(len(doc)):
                page = doc[page_num]
                images = page.get_images(full=True)

                for img_index, img in enumerate(images):
                    xref = img[0]
                    base_image = doc.extract_image(xref)
                    image_bytes = base_image["image"]
                    image_ext = base_image["ext"]

                    img_name = f"page{page_num + 1}_img{img_index + 1}.{image_ext}"
                    zf.writestr(img_name, image_bytes)
                    image_count += 1

        doc.close()

        if image_count == 0:
            zip_path.unlink()
            return jsonify({"error": "该PDF中没有找到图片"}), 400

        zip_size = os.path.getsize(str(zip_path))

        return jsonify(
            {
                "success": True,
                "filename": zip_name,
                "image_count": image_count,
                "size": zip_size,
                "size_formatted": format_size(zip_size),
            }
        )
    except Exception as e:
        if zip_path.exists():
            zip_path.unlink()
        return jsonify({"error": f"提取失败: {str(e)}"}), 500


# ==================== 合并 PDF ====================


@app.route("/api/merge", methods=["POST"])
def merge_pdfs():
    data = request.json
    filenames = data.get("filenames", [])

    if len(filenames) < 2:
        return jsonify({"error": "至少需要2个PDF文件进行合并"}), 400

    for fn in filenames:
        if not (UPLOAD_DIR / fn).exists():
            return jsonify({"error": f"文件 {fn} 不存在，请重新上传"}), 404

    output_name = f"merged_{uuid.uuid4().hex[:8]}.pdf"
    output_path = OUTPUT_DIR / output_name

    try:
        merged = fitz.open()
        total_pages = 0

        for fn in filenames:
            doc = fitz.open(str(UPLOAD_DIR / fn))
            merged.insert_pdf(doc)
            total_pages += doc.page_count
            doc.close()

        merged.save(str(output_path), garbage=4, deflate=True)
        merged.close()

        output_size = os.path.getsize(str(output_path))

        return jsonify(
            {
                "success": True,
                "filename": output_name,
                "file_count": len(filenames),
                "total_pages": total_pages,
                "size": output_size,
                "size_formatted": format_size(output_size),
            }
        )
    except Exception as e:
        return jsonify({"error": f"合并失败: {str(e)}"}), 500


# ==================== 拆分 PDF ====================


@app.route("/api/split", methods=["POST"])
def split_pdf():
    data = request.json
    filename = data.get("filename")
    pages_param = data.get("pages")

    if not filename:
        return jsonify({"error": "未指定文件"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在，请重新上传"}), 404

    base_stem = secure_filename(Path(filename).stem) or "document"
    zip_name = f"{base_stem}_split.zip"
    zip_path = OUTPUT_DIR / zip_name

    try:
        doc = fitz.open(str(input_path))
        total_pages = len(doc)

        if pages_param and isinstance(pages_param, list):
            page_indices = []
            for p in pages_param:
                if isinstance(p, int) and 1 <= p <= total_pages:
                    page_indices.append(p - 1)
                elif isinstance(p, str) and "-" in p:
                    parts = p.split("-")
                    try:
                        start, end = int(parts[0]), int(parts[1])
                        for pg in range(start, end + 1):
                            if 1 <= pg <= total_pages:
                                page_indices.append(pg - 1)
                    except ValueError:
                        pass
        else:
            page_indices = list(range(total_pages))

        if not page_indices:
            return jsonify({"error": "未选择有效页面"}), 400

        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
            for page_num in page_indices:
                new_doc = fitz.open()
                new_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)

                page_bytes = BytesIO()
                new_doc.save(page_bytes, garbage=4, deflate=True)
                new_doc.close()

                zf.writestr(
                    f"{base_stem}_page{page_num + 1}.pdf", page_bytes.getvalue()
                )

        doc.close()

        zip_size = os.path.getsize(str(zip_path))

        return jsonify(
            {
                "success": True,
                "filename": zip_name,
                "page_count": len(page_indices),
                "total_pages": total_pages,
                "size": zip_size,
                "size_formatted": format_size(zip_size),
            }
        )
    except Exception as e:
        if zip_path.exists():
            zip_path.unlink()
        return jsonify({"error": f"拆分失败: {str(e)}"}), 500


# ==================== 提取文字 ====================


@app.route("/api/extract-text", methods=["POST"])
def extract_text():
    data = request.json
    filename = data.get("filename")

    if not filename:
        return jsonify({"error": "未指定文件"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在，请重新上传"}), 404

    base_stem = secure_filename(Path(filename).stem) or "document"
    txt_name = f"{base_stem}.txt"
    txt_path = OUTPUT_DIR / txt_name

    try:
        doc = fitz.open(str(input_path))
        all_text = []
        total_chars = 0

        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                all_text.append(f"--- 第 {page_num + 1} 页 ---\n{text}")
                total_chars += len(text)

        doc.close()

        if not all_text:
            return jsonify({"error": "该PDF中没有可提取的文字（可能是扫描件）"}), 400

        with open(str(txt_path), "w", encoding="utf-8") as f:
            f.write("\n\n".join(all_text))

        txt_size = os.path.getsize(str(txt_path))

        return jsonify(
            {
                "success": True,
                "filename": txt_name,
                "char_count": total_chars,
                "size": txt_size,
                "size_formatted": format_size(txt_size),
            }
        )
    except Exception as e:
        return jsonify({"error": f"提取文字失败: {str(e)}"}), 500


# ==================== PDF 转图片 ====================


@app.route("/api/to-images", methods=["POST"])
def pdf_to_images():
    data = request.json
    filename = data.get("filename")
    dpi = data.get("dpi", 200)

    if not filename:
        return jsonify({"error": "未指定文件"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在，请重新上传"}), 404

    base_stem = secure_filename(Path(filename).stem) or "document"
    zip_name = f"{base_stem}_images.zip"
    zip_path = OUTPUT_DIR / zip_name

    try:
        doc = fitz.open(str(input_path))
        page_count = len(doc)

        zoom = dpi / 72
        mat = fitz.Matrix(zoom, zoom)

        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
            for page_num in range(page_count):
                page = doc[page_num]
                pix = page.get_pixmap(matrix=mat)

                img_bytes = pix.tobytes("png")
                img_name = f"{base_stem}_page{page_num + 1}.png"
                zf.writestr(img_name, img_bytes)

        doc.close()

        zip_size = os.path.getsize(str(zip_path))

        return jsonify(
            {
                "success": True,
                "filename": zip_name,
                "page_count": page_count,
                "dpi": dpi,
                "size": zip_size,
                "size_formatted": format_size(zip_size),
            }
        )
    except Exception as e:
        if zip_path.exists():
            zip_path.unlink()
        return jsonify({"error": f"转换失败: {str(e)}"}), 500


# ==================== 旋转页面 ====================


@app.route("/api/rotate", methods=["POST"])
def rotate_pdf():
    data = request.json
    filename = data.get("filename")
    angle = data.get("angle", 90)

    if angle not in [90, 180, 270]:
        return jsonify({"error": "旋转角度必须为90、180或270度"}), 400

    if not filename:
        return jsonify({"error": "未指定文件"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在，请重新上传"}), 404

    output_name = f"rotated_{angle}_{filename}"
    output_path = OUTPUT_DIR / output_name

    try:
        doc = fitz.open(str(input_path))
        total_pages = len(doc)

        for page_num in range(total_pages):
            page = doc[page_num]
            page.set_rotation((page.rotation + angle) % 360)

        doc.save(str(output_path), garbage=4, deflate=True)
        doc.close()

        output_size = os.path.getsize(str(output_path))

        return jsonify(
            {
                "success": True,
                "filename": output_name,
                "page_count": total_pages,
                "angle": angle,
                "size": output_size,
                "size_formatted": format_size(output_size),
            }
        )
    except Exception as e:
        return jsonify({"error": f"旋转失败: {str(e)}"}), 500


# ==================== 页面缩略图 ====================


@app.route("/api/thumbnails/<path:filename>")
def get_thumbnails(filename):
    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在"}), 404

    try:
        doc = fitz.open(str(input_path))
        results = []
        for i in range(len(doc)):
            page = doc[i]
            pix = page.get_pixmap(dpi=36)
            import base64

            img_b64 = base64.b64encode(pix.tobytes("png")).decode()
            results.append(f"data:image/png;base64,{img_b64}")
        doc.close()
        return jsonify({"pages": results, "total": len(results)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ==================== 页面排序 ====================


@app.route("/api/reorder", methods=["POST"])
def reorder_pages():
    data = request.json
    filename = data.get("filename")
    order = data.get("order", [])

    if not filename:
        return jsonify({"error": "未指定文件"}), 400
    if not isinstance(order, list) or len(order) < 2:
        return jsonify({"error": "排序参数无效"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在"}), 404

    output_name = f"reordered_{filename}"
    output_path = OUTPUT_DIR / output_name

    try:
        src = fitz.open(str(input_path))
        dst = fitz.open()
        for idx in order:
            if 0 <= idx < len(src):
                dst.insert_pdf(src, from_page=idx, to_page=idx)
        dst.save(str(output_path), garbage=4, deflate=True)
        src.close()
        dst.close()

        return jsonify(
            {
                "success": True,
                "filename": output_name,
                "page_count": len(order),
                "size": os.path.getsize(str(output_path)),
                "size_formatted": format_size(os.path.getsize(str(output_path))),
            }
        )
    except Exception as e:
        return jsonify({"error": f"排序失败: {str(e)}"}), 500


# ==================== 删除页面 ====================


@app.route("/api/delete-pages", methods=["POST"])
def delete_pages():
    data = request.json
    filename = data.get("filename")
    keep = data.get("keep", [])

    if not filename:
        return jsonify({"error": "未指定文件"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在"}), 404

    output_name = f"trimmed_{filename}"
    output_path = OUTPUT_DIR / output_name

    try:
        src = fitz.open(str(input_path))
        total = len(src)

        if not keep:
            return jsonify({"error": "至少保留一页"}), 400

        keep_set = {int(k) for k in keep if 0 <= int(k) < total}
        if not keep_set:
            return jsonify({"error": "没有有效页面可保留"}), 400

        dst = fitz.open()
        for idx in sorted(keep_set):
            dst.insert_pdf(src, from_page=idx, to_page=idx)
        dst.save(str(output_path), garbage=4, deflate=True)
        src.close()
        dst.close()

        return jsonify(
            {
                "success": True,
                "filename": output_name,
                "deleted": total - len(keep_set),
                "kept": len(keep_set),
                "size": os.path.getsize(str(output_path)),
                "size_formatted": format_size(os.path.getsize(str(output_path))),
            }
        )
    except Exception as e:
        return jsonify({"error": f"删除失败: {str(e)}"}), 500


# ==================== 添加水印 ====================


@app.route("/api/watermark", methods=["POST"])
def add_watermark():
    data = request.json
    filename = data.get("filename")
    text = (data.get("text") or "").strip()
    opacity = float(data.get("opacity", 0.2))
    font_size = int(data.get("fontSize", 60))
    color = data.get("color", "#cccccc")
    rotation = int(data.get("rotation", 0))
    # PyMuPDF only supports 0, 90, 180, 270 — snap to nearest
    rotation = round(rotation / 90) * 90 % 360
    spacing_level = int(data.get("spacing", 3))  # 1-6, 3=default

    if not filename:
        return jsonify({"error": "未指定文件"}), 400
    if not text:
        return jsonify({"error": "请输入水印文字"}), 400

    input_path = UPLOAD_DIR / filename
    if not input_path.exists():
        return jsonify({"error": "文件不存在"}), 404

    output_name = f"watermarked_{filename}"
    output_path = OUTPUT_DIR / output_name

    try:
        r = int(color[1:3], 16) / 255
        g = int(color[3:5], 16) / 255
        b = int(color[5:7], 16) / 255

        # Detect CJK characters to choose correct font
        has_cjk = any('\u4e00' <= ch <= '\u9fff' or '\u3400' <= ch <= '\u4dbf'
                      or '\uf900' <= ch <= '\ufaff' or '\u3040' <= ch <= '\u309f'
                      or '\u30a0' <= ch <= '\u30ff' or '\uac00' <= ch <= '\ud7af'
                      for ch in text)
        fontname = "china-ts" if has_cjk else "helv"

        doc = fitz.open(str(input_path))

        for page_num in range(len(doc)):
            page = doc[page_num]
            rect = page.rect
            w, h = rect.width, rect.height

            # Place repeated watermarks in a grid
            # spacing_level: 1(dense) ~ 6(sparse), controls multiplier
            text_width_est = len(text) * font_size * 0.5
            text_height_est = font_size * 1.5
            density = spacing_level / 3.0  # 1=0.33x(dense) 3=1x(default) 6=2x(sparse)
            spacing_x = max(text_width_est * (1.0 + density), w / (4 - spacing_level * 0.5))
            spacing_y = max(text_height_est * (1.5 + density), h / (4 - spacing_level * 0.5))

            y = spacing_y / 2
            while y < h:
                x = spacing_x / 2
                while x < w:
                    page.insert_text(
                        fitz.Point(x, y),
                        text,
                        fontname=fontname,
                        fontsize=font_size,
                        color=(r, g, b),
                        fill_opacity=opacity,
                        rotate=rotation,
                    )
                    x += spacing_x
                y += spacing_y

        doc.save(str(output_path), garbage=4, deflate=True)
        doc.close()

        return jsonify(
            {
                "success": True,
                "filename": output_name,
                "text": text,
                "size": os.path.getsize(str(output_path)),
                "size_formatted": format_size(os.path.getsize(str(output_path))),
            }
        )
    except Exception as e:
        return jsonify({"error": f"添加水印失败: {str(e)}"}), 500


# ==================== 下载 ====================


@app.route("/api/download/<path:filename>")
def download_file(filename):
    filepath = OUTPUT_DIR / filename
    if not filepath.exists():
        return jsonify({"error": "文件不存在或已过期，请重新处理"}), 404
    return send_file(str(filepath), as_attachment=True)


if __name__ == "__main__":
    print("PDF工具箱已启动: http://localhost:8080")
    app.run(debug=True, host="0.0.0.0", port=8080)
