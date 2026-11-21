#!/usr/bin/env python3
"""词刻漫画 OCR 服务：文本框检测 + 文字识别的统一契约。

协议
----
GET  /health
  -> {"ok": true, "engine": "mock"}

POST /ocr
  body: {"image": "data:image/jpeg;base64,...", "mime": "image/jpeg",
         "language": "en", "page": 0}
  -> {"regions": [{"text": "...", "box": [x0, y0, x1, y1],
                   "confidence": 92, "type": "dialogue"}]}

type 取值：dialogue / narration / sfx / uncertain；
也接受检测模型的原始标签 text_bubble / text_free，前端会自行归一化。

引擎
----
默认 mock，不加载模型，只用于前后端联调。
正式部署时在同目录放 pipeline_impl.py，实现 build_engine() 返回带
recognize(image_bytes, language) 方法的对象，然后：
    CIKE_OCR_ENGINE=custom python server.py --port 8787

pipeline_impl.py 里建议封装：
  1. RT-DETR-v2（ogkalu/comic-text-and-bubble-detector）检测，保留所有框；
  2. 按语言路由 OCR：ja/zh/en 手写用 Baberu OCR，竖排印刷用 Manga-OCR，
     韩语用 Pororo / EasyOCR；
  3. 输出上面的统一 regions，低置信度项由前端标记存疑并允许人工修正。

翻译不在这里做：前端把 regions 交给 AI 助手，用坐标和 JSON schema
锁定输出，避免一个多模态模型同时做看图、OCR、翻译和排版。
"""

import argparse
import base64
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class MockEngine:
    name = "mock"

    def recognize(self, image_bytes, language):
        # 固定三个文本区，坐标按 800x1200 的页面比例给出，便于联调。
        if (language or "en").startswith("zh"):
            texts = ["等等我！", "这条路我走过。", "咚——"]
        elif (language or "en").startswith("ja"):
            texts = ["待ってよ！", "この道は知ってる。", "ドン——"]
        elif (language or "en").startswith("ko"):
            texts = ["기다려!", "이 길은 알아.", "쿵——"]
        else:
            texts = ["Wait for me!", "I know this road.", "THUD"]
        return [
            {"text": texts[0], "box": [80, 120, 380, 220], "confidence": 94, "type": "text_bubble"},
            {"text": texts[1], "box": [420, 320, 740, 420], "confidence": 88, "type": "text_free"},
            {"text": texts[2], "box": [120, 820, 300, 960], "confidence": 52, "type": "sfx"},
        ]


def load_engine(requested):
    if requested == "mock":
        return MockEngine()
    if requested == "custom":
        try:
            from pipeline_impl import build_engine  # noqa: WPS433
        except ImportError as error:
            raise SystemExit(
                "找不到 pipeline_impl.py，或其中没有 build_engine()：%s" % error
            )
        engine = build_engine()
        if not hasattr(engine, "recognize"):
            raise SystemExit("build_engine() 返回的对象缺少 recognize(image_bytes, language)")
        return engine
    raise SystemExit("未知引擎：%s（可选 mock / custom）" % requested)


def decode_image(payload):
    image = payload.get("image") or ""
    if not isinstance(image, str) or not image:
        raise ValueError("缺少 image")
    if "," in image and image.strip().lower().startswith("data:"):
        image = image.split(",", 1)[1]
    return base64.b64decode(image)


class Handler(BaseHTTPRequestHandler):
    engine = MockEngine()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.rstrip("/") == "/health":
            self._json(200, {"ok": True, "engine": self.engine.name})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/ocr":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length) or b"{}")
            image = decode_image(payload)
            regions = self.engine.recognize(image, payload.get("language") or "en")
            self._json(200, {"regions": regions})
        except Exception as error:  # noqa: BLE001 - 契约服务只需返回可读错误
            self._json(400, {"error": str(error)})

    def log_message(self, fmt, *args):
        print("[comic-ocr] " + (fmt % args))


def main():
    parser = argparse.ArgumentParser(description="词刻漫画 OCR 服务")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--engine",
        default=os.environ.get("CIKE_OCR_ENGINE", "mock"),
        help="mock / custom（custom 需同目录 pipeline_impl.py）",
    )
    args = parser.parse_args()
    Handler.engine = load_engine(args.engine)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        "comic-ocr service listening on http://%s:%d (engine=%s)"
        % (args.host, args.port, Handler.engine.name)
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()