import os
import sys
import json
import warnings
warnings.filterwarnings('ignore')

import torch
import soundfile as sf
import numpy as np
from scipy import signal
from speechbrain.inference.speaker import EncoderClassifier

sys.stdout.reconfigure(encoding='utf-8')

def load_audio(path, target_sr=16000):
    data, sr = sf.read(path)
    if len(data.shape) > 1:
        data = data.mean(axis=1)
    if sr != target_sr:
        data = signal.resample_poly(data, target_sr, sr)
    return data.astype(np.float32)

def main():
    batch_size = 6
    if len(sys.argv) > 1:
        try:
            batch_size = int(sys.argv[1])
        except:
            pass

    db_path = os.path.join('data', 'oybek_samples.json')
    if not os.path.exists(db_path):
        print(json.dumps({"success": False, "error": "oybek_samples.json topilmadi"}))
        sys.exit(0)

    with open(db_path, 'r', encoding='utf-8') as f:
        existing_samples = json.load(f)

    approved = [s for s in existing_samples if s.get('status') == 'approved']
    if not approved:
        print(json.dumps({"success": False, "error": "Snowball uchun avval kamida 1-2 ta Oybek namunasini tasdiqlash kerak!"}))
        sys.exit(0)

    model_dir = 'tmp_model'
    enc = EncoderClassifier.from_hparams(
        source='speechbrain/spkrec-ecapa-voxceleb',
        savedir=model_dir
    )

    sample_dir = os.path.join('public', 'samples', 'oybek')
    approved_embs = []
    for s in approved:
        fname = s.get('file')
        p = os.path.join(sample_dir, fname)
        if os.path.exists(p):
            aud = load_audio(p)
            t = torch.from_numpy(aud).float().unsqueeze(0)
            emb = enc.encode_batch(t).squeeze()
            approved_embs.append(emb)

    if not approved_embs:
        print(json.dumps({"success": False, "error": "Tasdiqlangan namunalar audio fayllari topilmadi"}))
        sys.exit(0)

    # Unit-normalized reference vector of Oybek
    ref_emb = torch.mean(torch.stack(approved_embs, dim=0), dim=0)
    ref_emb = torch.nn.functional.normalize(ref_emb, p=2, dim=0)

    # Track intervals already used (both approved and denied and pending)
    used_intervals = {}
    max_id_num = 0
    max_batch = 1
    for s in existing_samples:
        src = s.get('source_file')
        st = s.get('start_sec', 0)
        en = s.get('end_sec', st + 3.5)
        if src not in used_intervals:
            used_intervals[src] = []
        used_intervals[src].append((st, en))

        sid = s.get('id', '')
        if sid.startswith('oybek_sample_'):
            try:
                num = int(sid.replace('oybek_sample_', ''))
                if num > max_id_num:
                    max_id_num = num
            except:
                pass
        b = s.get('batch', 1)
        if isinstance(b, int) and b > max_batch:
            max_batch = b

    next_batch = max_batch + 1

    # Scan available raw call files
    oybek_raw_dir = os.path.join('scratch', 'oybek')
    # Prioritize call3 (which has high-similarity Oybek speech), then call1, then call2
    call_files = ['oybek_call3.wav', 'oybek_call1.wav', 'oybek_call2.wav']

    candidates = []
    win_sec = 3.5
    step_sec = 3.0
    sr = 16000
    win_samples = int(win_sec * sr)
    step_samples = int(step_sec * sr)

    for cf in call_files:
        full_p = os.path.join(oybek_raw_dir, cf)
        if not os.path.exists(full_p):
            continue
        audio = load_audio(full_p)
        total_len = len(audio)
        if total_len < win_samples:
            continue

        raw_used = used_intervals.get(cf, [])

        # Collect speech chunks
        chunks_info = []
        chunks_tensors = []
        for start_idx in range(0, total_len - win_samples, step_samples):
            st_sec = round(start_idx / sr, 1)
            en_sec = round((start_idx + win_samples) / sr, 1)

            # Check overlap with existing used intervals (margin 1.5 sec)
            overlap = False
            for (ust, uen) in raw_used:
                if not (en_sec <= ust - 1.0 or st_sec >= uen + 1.0):
                    overlap = True
                    break
            if overlap:
                continue

            chunk = audio[start_idx:start_idx + win_samples]
            rms = np.sqrt(np.mean(chunk**2))
            if rms < 0.04:
                continue

            chunks_info.append({
                "source_file": cf,
                "start_sec": st_sec,
                "end_sec": en_sec,
                "rms": float(rms),
                "chunk": chunk
            })
            chunks_tensors.append(torch.from_numpy(chunk).float())

        if not chunks_tensors:
            continue

        # Batch encode in chunks of 24
        batch_tensors = torch.stack(chunks_tensors, dim=0) # [N, samples]
        batch_embs = []
        for b_start in range(0, len(batch_tensors), 24):
            b_chunk = batch_tensors[b_start:b_start + 24]
            with torch.no_grad():
                embs = enc.encode_batch(b_chunk).squeeze(1) # [B, emb_dim]
                batch_embs.append(embs)
        all_file_embs = torch.cat(batch_embs, dim=0) # [N, emb_dim]

        # Compute cosine similarities with ref_emb
        sims = torch.nn.functional.cosine_similarity(all_file_embs, ref_emb.unsqueeze(0), dim=1).tolist()

        for info, sim in zip(chunks_info, sims):
            if sim >= 0.70: # Strict high similarity threshold!
                info["similarity"] = round(sim, 4)
                candidates.append(info)

        # If we already have enough high-confidence candidates, no need to process next file
        if len(candidates) >= batch_size * 2:
            break

    # Sort candidates by similarity (highest first)
    candidates.sort(key=lambda c: c["similarity"], reverse=True)

    # Select non-overlapping top K candidates
    selected = []
    selected_used = {}
    for c in candidates:
        src = c["source_file"]
        st = c["start_sec"]
        en = c["end_sec"]
        if src not in selected_used:
            selected_used[src] = []

        overlap = False
        for (ust, uen) in selected_used[src]:
            if not (en <= ust - 1.5 or st >= uen + 1.5):
                overlap = True
                break
        if overlap:
            continue

        selected_used[src].append((st, en))
        selected.append(c)
        if len(selected) >= batch_size:
            break

    if not selected:
        print(json.dumps({"success": False, "error": "Qo'shimcha yuqori o'xshashlikdagi yangi namunalar topilmadi."}))
        sys.exit(0)

    new_saved_meta = []
    for item in selected:
        max_id_num += 1
        new_id = f"oybek_sample_{max_id_num}"
        fname = f"{new_id}.wav"
        out_wav_path = os.path.join(sample_dir, fname)
        sf.write(out_wav_path, item["chunk"], sr)

        meta_item = {
            "id": new_id,
            "file": fname,
            "url": f"/samples/oybek/{fname}",
            "source_file": item["source_file"],
            "start_sec": item["start_sec"],
            "end_sec": item["end_sec"],
            "rms": round(item["rms"], 4),
            "similarity": item["similarity"],
            "batch": next_batch,
            "status": "pending",
            "caller_id": "Oybek (101) suhbati",
            "time_range": f"{item['start_sec']}s - {item['end_sec']}s",
            "description": f"AI Oybek o'xshashligi: {int(item['similarity'] * 100)}%"
        }
        existing_samples.append(meta_item)
        new_saved_meta.append(meta_item)

    # Save updated meta
    with open(db_path, 'w', encoding='utf-8') as f:
        json.dump(existing_samples, f, indent=2, ensure_ascii=False)

    approved_count = len([s for s in existing_samples if s.get('status') == 'approved'])
    denied_count = len([s for s in existing_samples if s.get('status') == 'denied'])
    pending_count = len([s for s in existing_samples if s.get('status') == 'pending' or not s.get('status')])

    res = {
        "success": True,
        "batch": next_batch,
        "new_samples_count": len(new_saved_meta),
        "total_samples": len(existing_samples),
        "new_samples": new_saved_meta,
        "stats": {
            "total": len(existing_samples),
            "approved": approved_count,
            "denied": denied_count,
            "pending": pending_count
        },
        "message": f"Snowball: Oybek ovoziga 70%+ o'xshash bo'lgan {len(new_saved_meta)} ta yangi toza namuna olindi!"
    }
    print(json.dumps(res, ensure_ascii=False))

if __name__ == '__main__':
    main()
