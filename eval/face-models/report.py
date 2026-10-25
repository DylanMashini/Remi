"""Scores the embeddings FaceEval wrote and renders RESULTS.md + results.json.

    python report.py --manifest <data>/manifest.json --run <outdir> [--models models.json] [--out RESULTS.md]

Protocols (all use the official 6,000 LFW pairs, 10 folds):
  clean    image A vs image B as released
  <tier>   image A (clean, the "enrollment photo") vs image B degraded to that tier (the "glasses frame")

Metrics per model and protocol:
  acc10     standard LFW 10-fold accuracy: threshold picked on 9 folds, tested on the 10th, averaged;
            only pairs where both faces were detected count (how papers report LFW)
  tar@far   true-accept rate at 1% and 0.1% false-accept rate, both-detected pairs
  acc@0.50  accuracy at the phone's fixed threshold (LocalRecognition.matchThreshold), both-detected pairs
  e2e@0.50  end-to-end: a pair with an undetected or too-small face is a non-match, so a missed
            detection on a same-person pair is an error (what the wearer experiences)
  miss      share of pairs where at least one side had no usable face
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

PHONE_THRESHOLD = 0.5


def load_run(run: Path, manifest: dict) -> tuple[dict, dict[str, np.ndarray], dict[str, int]]:
    meta = json.loads((run / "meta.json").read_text())
    order = {img_id: i for i, img_id in enumerate(meta["imageOrder"])}
    detected = np.array([bool(m.get("detected")) for m in meta["images"]])
    embs = {}
    for name, info in meta["models"].items():
        arr = np.fromfile(run / f"{name}.f32", dtype=np.float32).reshape(len(order), info["dim"])
        embs[name] = arr
    return meta, embs, order, detected


def ten_fold_accuracy(scores: np.ndarray, same: np.ndarray, folds: np.ndarray) -> tuple[float, float]:
    """Returns (mean accuracy, mean chosen threshold) with the LFW protocol."""
    cands = np.unique(np.round(scores, 3))
    accs, thrs = [], []
    for k in np.unique(folds):
        tr, te = folds != k, folds == k
        best_t, best_a = 0.0, -1.0
        for t in cands:
            a = np.mean((scores[tr] >= t) == same[tr])
            if a > best_a:
                best_a, best_t = a, t
        accs.append(np.mean((scores[te] >= best_t) == same[te]))
        thrs.append(best_t)
    return float(np.mean(accs)), float(np.mean(thrs))


def tar_at_far(scores: np.ndarray, same: np.ndarray, far: float) -> float:
    neg = np.sort(scores[~same])[::-1]
    idx = max(0, int(np.floor(far * len(neg))) - 1)
    thr = neg[idx] if len(neg) else 1.0
    return float(np.mean(scores[same] > thr))


def evaluate(embs: np.ndarray, order: dict, detected: np.ndarray, pairs: list[dict], b_key: str) -> dict:
    ia = np.array([order[p["a"]] for p in pairs])
    ib = np.array([order[p[b_key]] for p in pairs])
    same = np.array([p["same"] for p in pairs])
    folds = np.array([p["fold"] for p in pairs])
    ok = detected[ia] & detected[ib]
    scores = np.einsum("ij,ij->i", embs[ia], embs[ib])
    s, sm, fd = scores[ok], same[ok], folds[ok]
    acc10, thr10 = ten_fold_accuracy(s, sm, fd)
    e2e_pred = ok & (scores >= PHONE_THRESHOLD)
    return {
        "pairs": int(len(pairs)),
        "missRate": float(np.mean(~ok)),
        "acc10": acc10,
        "thr10": thr10,
        "tar@1%": tar_at_far(s, sm, 0.01),
        "tar@0.1%": tar_at_far(s, sm, 0.001),
        "acc@phone": float(np.mean((s >= PHONE_THRESHOLD) == sm)),
        "e2e@phone": float(np.mean(e2e_pred == same)),
        "sameMean": float(s[sm].mean()),
        "sameP10": float(np.percentile(s[sm], 10)),
        "diffMean": float(s[~sm].mean()),
        "diffP99": float(np.percentile(s[~sm], 99)),
    }


def sweep(embs: np.ndarray, order: dict, detected: np.ndarray, pairs: list[dict], b_key: str, thr: float) -> tuple[float, float]:
    """(TAR, FAR) at a fixed threshold over both-detected pairs."""
    ia = np.array([order[p["a"]] for p in pairs])
    ib = np.array([order[p[b_key]] for p in pairs])
    same = np.array([p["same"] for p in pairs])
    ok = detected[ia] & detected[ib]
    scores = np.einsum("ij,ij->i", embs[ia], embs[ib])[ok]
    sm = same[ok]
    return float(np.mean(scores[sm] >= thr)), float(np.mean(scores[~sm] >= thr))


def pct(x: float) -> str:
    return f"{100 * x:.2f}%"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--run", required=True)
    ap.add_argument("--models", default=None, help="models.json with labels/sizes/licenses")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    manifest = json.loads(Path(args.manifest).read_text())
    run = Path(args.run)
    meta, embs, order, detected = load_run(run, manifest)
    info = json.loads(Path(args.models).read_text()) if args.models else {}
    pairs = manifest["pairs"]
    protocols = ["clean"] + list(manifest["tiers"].keys())

    # models.json order is the presentation order (small to large); anything else goes at the end.
    names = [n for n in info if n in meta["models"]] + [n for n in meta["models"] if n not in info]
    results: dict = {"host": meta.get("host"), "detectMsMedian": meta["detectMsMedian"], "models": {}}
    for name in names:
        r = {"speed": meta["models"][name], "protocols": {}}
        for proto in protocols:
            r["protocols"][proto] = evaluate(embs[name], order, detected, pairs, "b" if proto == "clean" else proto)
        results["models"][name] = r

    lines = []
    lines.append("# Face embedder evaluation (LFW, phone pipeline)\n")
    lines.append(f"Host: macOS {meta.get('host')}, Apple Vision face detection median {meta['detectMsMedian']:.1f} ms per image. "
                 f"{meta['detected']} of {len(meta['images'])} images had a usable face (Vision box ≥ 36 px).\n")
    lines.append("## Speed and size\n")
    lines.append("| Model | Params | Compiled size | Load | Embed median, `.all` (during the run) | p90 | Embed median, `.cpuAndNeuralEngine` (isolated) | License |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for name, r in results["models"].items():
        i = info.get(name, {})
        sp = r["speed"]
        ane = f"{i['aneMs']:.2f} ms" if "aneMs" in i else ""
        lines.append(f"| {i.get('label', name)} | {i.get('params', '')} | {i.get('sizeMB', '')} | {sp['loadMs']:.0f} ms | "
                     f"{sp['predictMsMedian']:.2f} ms | {sp['predictMsP90']:.2f} ms | {ane} | {i.get('license', '')} |")
    lines.append("")
    lines.append("`.all` is what the app uses today and what FaceEval ran with, measured while Vision and six other models shared the "
                 "Neural Engine. The isolated column is ComputePlan.swift with `computeUnits = .cpuAndNeuralEngine`, 50 predictions on one crop. "
                 "For EdgeFace and LVFace, Core ML's automatic placement under `.all` prefers the GPU even though every op is Neural "
                 "Engine capable, which is why their `.all` numbers are 5 to 10x worse; pin them to the Neural Engine if adopted.\n")
    for proto in protocols:
        if proto == "clean":
            lines.append("## Clean vs clean (standard LFW)\n")
        else:
            t = manifest["tiers"][proto]
            lines.append(f"## Clean enrollment photo vs glasses-like frame: face ≈ {t['facePx']} px wide, JPEG q{t['jpegQuality']}\n")
        lines.append("| Model | 10-fold acc | TAR@1% FAR | TAR@0.1% FAR | acc @0.50 | end-to-end @0.50 | miss rate | same mean / p10 | diff mean / p99 | best thr |")
        lines.append("|---|---|---|---|---|---|---|---|---|---|")
        for name, r in results["models"].items():
            p = r["protocols"][proto]
            lines.append(f"| {info.get(name, {}).get('label', name)} | {pct(p['acc10'])} | {pct(p['tar@1%'])} | {pct(p['tar@0.1%'])} | "
                         f"{pct(p['acc@phone'])} | {pct(p['e2e@phone'])} | {pct(p['missRate'])} | "
                         f"{p['sameMean']:.2f} / {p['sameP10']:.2f} | {p['diffMean']:.2f} / {p['diffP99']:.2f} | {p['thr10']:.2f} |")
        lines.append("")
    # Threshold sweep: what the phone would do at other fixed thresholds (same-person accept rate and
    # stranger accept rate per comparison). The roster has N people, so the chance a stranger matches
    # somebody is roughly N x FAR.
    sweep_thrs = [0.20, 0.25, 0.30, 0.35, 0.40, 0.50]
    for proto in protocols:
        title = "clean vs clean" if proto == "clean" else f"clean vs face ≈ {manifest['tiers'][proto]['facePx']} px"
        lines.append(f"## Threshold sweep, {title}: same-person accept rate / stranger accept rate (per comparison)\n")
        lines.append("| Model | " + " | ".join(f"thr {t:.2f}" for t in sweep_thrs) + " |")
        lines.append("|---|" + "---|" * len(sweep_thrs))
        for name in results["models"]:
            cells = []
            for t in sweep_thrs:
                s = sweep(embs[name], order, detected, pairs, "b" if proto == "clean" else proto, t)
                cells.append(f"{100 * s[0]:.1f}% / {100 * s[1]:.2f}%")
            lines.append(f"| {info.get(name, {}).get('label', name)} | " + " | ".join(cells) + " |")
            results["models"][name].setdefault("sweep", {})[proto] = {
                f"{t:.2f}": sweep(embs[name], order, detected, pairs, "b" if proto == "clean" else proto, t) for t in sweep_thrs
            }
        lines.append("")
    text = "\n".join(lines)
    out = Path(args.out) if args.out else run / "RESULTS.md"
    out.write_text(text)
    (run / "results.json").write_text(json.dumps(results, indent=2))
    print(text)


if __name__ == "__main__":
    main()
