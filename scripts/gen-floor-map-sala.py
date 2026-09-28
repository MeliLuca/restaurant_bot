"""Emit SQL for the "Sala" floor map traced from TAVOLI.pdf (2026-09-28).

Coordinates are in map units = pixels of the scan resized to 895x1200.
Crossed-out tables on the paper map are left out on purpose.
Usage: python3 scripts/gen-floor-map-sala.py > /tmp/sala.sql
"""
import json

MAP_ID = "b0000000-0000-0000-0000-000000000001"
W, H = 895, 1200

RECTS = [  # name, x1, y1, x2, y2
    ("1", 188, 47, 247, 110), ("2", 302, 46, 340, 124), ("3", 380, 45, 419, 124),
    ("4", 460, 45, 495, 125), ("10", 765, 37, 853, 110), ("11", 768, 122, 855, 160),
    ("12", 753, 185, 855, 224), ("13", 753, 248, 855, 288), ("21", 668, 145, 708, 247),
    ("14", 790, 310, 828, 377), ("15", 790, 390, 828, 455), ("16", 790, 467, 828, 535),
    ("59", 50, 197, 114, 265), ("56", 114, 563, 174, 603), ("55", 114, 615, 175, 655),
    ("54", 115, 666, 175, 706), ("53", 114, 717, 177, 760), ("32", 280, 563, 313, 628),
    ("31", 350, 561, 417, 594), ("41", 463, 559, 528, 592), ("40", 565, 557, 598, 620),
    ("33", 282, 643, 314, 708), ("35", 351, 640, 384, 705), ("39", 497, 637, 529, 702),
    ("38", 565, 635, 598, 700), ("34", 282, 722, 368, 757), ("37", 513, 715, 599, 750),
    ("46", 270, 777, 375, 812), ("45", 402, 773, 487, 806), ("42", 505, 770, 611, 804),
    ("24", 737, 605, 840, 645), ("27", 739, 705, 777, 752), ("25", 801, 672, 840, 773),
    ("26", 739, 800, 840, 838), ("48", 318, 883, 405, 918), ("44", 525, 876, 612, 911),
    ("68", 328, 938, 411, 982), ("67", 329, 992, 411, 1036), ("66", 329, 1045, 411, 1090),
    ("65", 329, 1098, 411, 1140), ("61", 555, 932, 636, 975), ("62", 556, 986, 636, 1028),
    ("63", 557, 1040, 638, 1082), ("64", 557, 1092, 638, 1136), ("201", 761, 860, 842, 900),
    ("203", 736, 967, 771, 1016), ("202", 805, 920, 845, 1061), ("204", 783, 1083, 848, 1118),
    ("205", 767, 1131, 849, 1172), ("306", 128, 1012, 200, 1043), ("305", 82, 1015, 118, 1075),
    ("304", 82, 1085, 118, 1145), ("309", 240, 1076, 273, 1122), ("303", 84, 1153, 145, 1188),
    ("302", 155, 1150, 217, 1185), ("301", 227, 1147, 287, 1183),
]
CIRCLES = [  # name, cx, cy, r
    ("9", 217, 163, 20), ("8", 285, 192, 20), ("7", 512, 192, 21), ("19", 697, 495, 19),
    ("18", 737, 568, 20), ("17", 810, 568, 20), ("36", 441, 725, 31), ("60", 482, 1005, 33),
    ("308", 191, 1067, 23), ("307", 189, 1116, 22),
]
ROTATED = [  # name, cx, cy, side, degrees
    ("102/3", 570, 318, 40, -12), ("102/2", 594, 367, 38, 8), ("102/1", 584, 418, 38, -10),
]
# 102/4: the tall oval table by the 102s (rx 17, ry 30 around 556,265, tilted -20°)
PATH_102_4 = "M556 235 A17 30 0 0 1 556 295 A17 30 0 0 1 556 235 Z"
# 101: the curved counter by the take-away corner (bbox 172..224 x 302..464)
PATH_101 = "M172 310 L198 302 Q244 382 205 460 L178 464 Q217 386 172 310 Z"


def capacity(w, h, circle=False):
    """Seat estimate from the drawn size; editable afterwards in Settings."""
    if circle:
        return 2 if w / 2 < 25 else 6
    long = max(w, h)
    for limit, seats in ((50, 2), (75, 4), (95, 6), (120, 8)):
        if long < limit:
            return seats
    return 10


def elements():
    e = []
    rect = lambda x, y, w, h, style="wall": e.append(
        {"kind": "rect", "x": x, "y": y, "w": w, "h": h, "style": style})
    path = lambda d, style="wall": e.append({"kind": "path", "d": d, "style": style})

    def text(x, y, s, size=18, rotate=0, anchor="start", font="serif"):
        el = {"kind": "text", "x": x, "y": y, "text": s, "size": size}
        if rotate: el["rotate"] = rotate
        if anchor != "start": el["anchor"] = anchor
        if font != "serif": el["font"] = font
        e.append(el)

    # structure
    path("M188 20 V175 L263 218 H535 L607 180 V15")                 # palco 1
    path("M335 201 H463 M335 206 H463 M335 211 H463 M335 216 H463")  # gradini
    rect(312, 293, 190, 162)                                        # banco
    path("M662 145 V500 L705 580")                                  # palco 2
    path("M740 10 V93")
    rect(270, 547, 340, 217)                                        # palco centrale
    rect(318, 922, 332, 238)                                        # palco 60
    path("M725 848 H870 M725 932 V1085 M725 1143 V1200")            # palco 3
    path("M37 183 H117 M40 357 H93 V470 M95 555 V740 M38 935 H67 M95 935 H117")
    # labels + arrows
    text(78, 150, "ENTRATA", 20, rotate=-40)
    path("M83 162 L150 108")
    path("M132 146 L150 162 M150 162 L143 150 M150 162 L138 158", "arrow")
    text(628, 67, "USCITA")
    path("M638 112 V88 M632 94 L638 84 L644 94", "arrow")
    text(97, 289, "USCITA", 15, anchor="middle")
    text(97, 306, "CHIUSURA", 15, anchor="middle")
    path("M107 329 H84 M92 323 L83 329 L92 335", "arrow")
    text(407, 382, "BANCO", 20, anchor="middle")
    text(183, 360, "ASPORTO", 11, rotate=80, font="hand")
    text(355, 185, "PALCO 1", font="hand")
    text(705, 300, "PALCO 2", rotate=75, font="hand")
    text(397, 676, "P CENTRALE", 14, font="hand")
    text(722, 875, "PALCO 3", 14, rotate=60, font="hand")
    text(76, 650, "CUCINA", rotate=-90)
    path("M137 522 H110 M118 516 L109 522 L118 528", "arrow")
    text(76, 918, "PIZZERIA", rotate=-90)
    path("M138 858 H111 M119 852 L110 858 L119 864", "arrow")
    return e


def rows():
    out = []  # name, capacity, shape, x, y, w, h, rotation, path
    for n, x1, y1, x2, y2 in RECTS:
        out.append((n, capacity(x2 - x1, y2 - y1), "rect", x1, y1, x2 - x1, y2 - y1, 0, None))
    for n, cx, cy, r in CIRCLES:
        out.append((n, capacity(2 * r, 2 * r, True), "circle", cx - r, cy - r, 2 * r, 2 * r, 0, None))
    for n, cx, cy, s, a in ROTATED:
        out.append((n, 2, "rect", cx - s / 2, cy - s / 2, s, s, a, None))
    out.append(("101", 4, "path", 172, 302, 52, 162, 0, PATH_101))
    out.append(("102/4", 4, "path", 539, 235, 34, 60, -20, PATH_102_4))
    return out


def sql_str(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def main():
    print(f"insert into floor_maps (id, name, width, height, elements, sort_order) values")
    print(f"  ('{MAP_ID}', 'Sala', {W}, {H}, {sql_str(json.dumps(elements(), separators=(',', ':')))}::jsonb, 0)")
    print("on conflict (id) do nothing;\n")
    print("insert into tables (id, name, capacity, status, map_id, shape, x, y, w, h, rotation, path) values")
    vals = []
    for i, (n, cap, shape, x, y, w, h, rot, p) in enumerate(rows(), start=101):
        tid = f"10000000-0000-0000-0000-{i:012d}"
        vals.append(f"  ('{tid}', {sql_str(n)}, {cap}, 'available', '{MAP_ID}', '{shape}', "
                    f"{x:g}, {y:g}, {w:g}, {h:g}, {rot:g}, {sql_str(p)})")
    print(",\n".join(vals))
    print("on conflict (id) do nothing;")


if __name__ == "__main__":
    main()
