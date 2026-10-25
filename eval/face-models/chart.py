"""Renders results.json as one PNG for the write-up: end-to-end accuracy at the phone's threshold
per model and protocol, and Neural Engine latency per face.

    python chart.py --results out/full/results.json --models models.json --out results.png
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

SURFACE = "#fcfcfb"
TEXT = "#0b0b0b"
TEXT2 = "#52514e"
GRID = "#e4e3df"
SERIES = {"clean": "#2a78d6", "face56": "#eb6834", "face40": "#1baf7a"}  # validated categorical slots 1-3
LABELS = {"clean": "clean photo vs clean photo", "face56": "clean vs 56 px frame", "face40": "clean vs 40 px frame"}
ORDER = ["mbf", "edgeface_xs", "edgeface_s", "sface", "lvface_t", "r50", "r100"]
SHORT = {
    "mbf": "MobileFaceNet", "edgeface_xs": "EdgeFace-XS", "edgeface_s": "EdgeFace-S", "sface": "SFace",
    "lvface_t": "LVFace-T", "r50": "ResNet50\nArcFace (shipped)", "r100": "ResNet100\nArcFace",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", required=True)
    ap.add_argument("--models", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--metric", default="e2e@phone", help="e2e@phone (threshold 0.50) or acc10")
    args = ap.parse_args()
    res = json.loads(Path(args.results).read_text())["models"]
    info = json.loads(Path(args.models).read_text())
    models = [m for m in ORDER if m in res]
    protos = [p for p in SERIES if p in next(iter(res.values()))["protocols"]]

    plt.rcParams.update({"font.family": "Helvetica Neue, Helvetica, Arial, sans-serif", "font.size": 10, "text.color": TEXT,
                         "axes.labelcolor": TEXT2, "xtick.color": TEXT2, "ytick.color": TEXT2})
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(13, 5.2), facecolor=SURFACE, gridspec_kw={"width_ratios": [2.2, 1]})

    # Left: grouped bars, accuracy at the phone threshold.
    n = len(protos)
    w = 0.8 / n
    # The 0.50-threshold diagnosis spans 60-100 and reads as bars. The threshold-free metric sits in
    # 93-99, so it is drawn as a dot plot on a zoomed axis (no bar length to lie about).
    dots = args.metric != "e2e@phone"
    for j, p in enumerate(protos):
        xs = [i + (j - (n - 1) / 2) * w for i in range(len(models))]
        ys = [100 * res[m]["protocols"][p][args.metric] for m in models]
        if dots:
            ax.scatter(xs, ys, s=64, color=SERIES[p], label=LABELS[p], zorder=3, edgecolors=SURFACE, linewidths=1.5)
            for x, y in zip(xs, ys):
                ax.text(x, y + 0.25, f"{y:.1f}", ha="center", va="bottom", fontsize=7.5, color=TEXT2)
        else:
            bars = ax.bar(xs, ys, width=w - 0.03, color=SERIES[p], label=LABELS[p], linewidth=0, zorder=3)
            for b, y in zip(bars, ys):
                ax.text(b.get_x() + b.get_width() / 2, y + 0.8, f"{y:.0f}", ha="center", va="bottom", fontsize=8, color=TEXT2)
    ax.set_facecolor(SURFACE)
    ax.set_xticks(range(len(models)), [SHORT[m] for m in models])
    ax.set_ylim((91, 100.4) if dots else (50, 102))
    ylabels = {
        "e2e@phone": "accuracy at the original 0.50 threshold (%)",
        "acc10": "LFW 10-fold accuracy (%)",
        "tar@0.1%": "same-person pairs recognized at 1-in-1,000 stranger accepts (%)",
    }
    titles = {
        "e2e@phone": "Diagnosis: what the README's 0.50 threshold did to each model",
        "acc10": "LFW 10-fold accuracy, phone pipeline",
        "tar@0.1%": "Who gets recognized: 6,000 LFW pairs through the phone pipeline",
    }
    ax.set_ylabel(ylabels.get(args.metric, args.metric))
    title = titles.get(args.metric, args.metric)
    ax.set_title(title, loc="left", fontsize=12, color=TEXT, pad=14)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(length=0)
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.16), fontsize=9, ncol=3)

    # Right: latency per face on the Neural Engine, horizontal bars.
    # Isolated Neural Engine timing from ComputePlan.swift (models.json aneMs); falls back to the run's .all median.
    lat = [info.get(m, {}).get("aneMs", res[m]["speed"]["predictMsMedian"]) for m in models]
    ys = range(len(models))[::-1]
    ax2.barh(list(ys), lat, color="#2a78d6", height=0.6, linewidth=0, zorder=3)
    for y, v, m in zip(ys, lat, models):
        ax2.text(v + 0.06, y, f"{v:.2f} ms  ·  {info.get(m, {}).get('sizeMB', '')}", va="center", fontsize=8.5, color=TEXT2)
    ax2.set_yticks(list(ys), [SHORT[m].replace("\n", " ") for m in models])
    ax2.set_facecolor(SURFACE)
    ax2.set_xlim(0, max(lat) * 1.9)
    ax2.set_xlabel("ms per face, Neural Engine")
    ax2.set_title("Cost per face", loc="left", fontsize=12, color=TEXT, pad=14)
    ax2.xaxis.grid(True, color=GRID, linewidth=0.8, zorder=0)
    ax2.set_axisbelow(True)
    for s in ("top", "right", "left"):
        ax2.spines[s].set_visible(False)
    ax2.spines["bottom"].set_color(GRID)
    ax2.tick_params(length=0)

    fig.text(0.01, 0.01, "Apple Vision face box → 1.3× crop → 112×112 → Core ML embedder; same crop for every model. "
             "Frames shrunk and JPEG-compressed to the face sizes a 504×896 glasses stream delivers.", fontsize=8, color=TEXT2)
    fig.tight_layout(rect=(0, 0.05, 1, 1))
    fig.savefig(args.out, dpi=180, facecolor=SURFACE)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
