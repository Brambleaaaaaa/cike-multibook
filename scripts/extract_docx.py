import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def paragraph_text(node):
    fragments = []
    for element in node.iter():
        if element.tag == W + "t" and element.text:
            fragments.append(element.text)
        elif element.tag == W + "tab":
            fragments.append("\t")
        elif element.tag in {W + "br", W + "cr"}:
            fragments.append("\n")
    return "".join(fragments)


def table_rows(table):
    rows = []
    for row in table.findall(W + "tr"):
        cells = []
        for cell in row.findall(W + "tc"):
            parts = []
            for child in cell:
                if child.tag == W + "p":
                    parts.append(paragraph_text(child))
                elif child.tag == W + "tbl":
                    nested = table_rows(child)
                    parts.append(
                        "\n".join("\t".join(row_values) for row_values in nested)
                    )
            cells.append("\n".join(part for part in parts if part).strip())
        rows.append(cells)
    return rows


def main():
    source = Path(sys.argv[1])
    output_json = Path(sys.argv[2])
    output_text = Path(sys.argv[3])

    with zipfile.ZipFile(source) as archive:
        document = ET.fromstring(archive.read("word/document.xml"))

    body = document.find(W + "body")
    blocks = []
    plain_lines = []

    for child in body:
        if child.tag == W + "p":
            text = paragraph_text(child)
            blocks.append({"type": "paragraph", "text": text})
            plain_lines.append(text)
        elif child.tag == W + "tbl":
            rows = table_rows(child)
            blocks.append({"type": "table", "rows": rows})
            for row in rows:
                plain_lines.append("\t".join(row))

    payload = {
        "source": source.name,
        "blockCount": len(blocks),
        "nonEmptyParagraphs": sum(
            1
            for block in blocks
            if block["type"] == "paragraph" and block["text"].strip()
        ),
        "tableCount": sum(1 for block in blocks if block["type"] == "table"),
        "blocks": blocks,
    }
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    output_text.write_text("\n".join(plain_lines), encoding="utf-8")
    print(
        json.dumps(
            {
                "blocks": payload["blockCount"],
                "nonEmptyParagraphs": payload["nonEmptyParagraphs"],
                "tables": payload["tableCount"],
                "characters": sum(len(line) for line in plain_lines),
                "json": str(output_json),
                "text": str(output_text),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
