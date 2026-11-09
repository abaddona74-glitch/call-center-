import os
import sys
import json
import gc
import warnings
warnings.filterwarnings('ignore')

import torch
# Restrict CPU threads to avoid lagging the system
torch.set_num_threads(2)

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
    print("🎯 Zuhra + Oybek dual-speaker (birgalikda qatnashgan) qo'ng'iroqni qidirish boshlandi...")
    print("⚙️ Resurs tejash rejimi faol: CPU threads = 2, RAM chegarasi < 500 MB\n")

    id_file = os.path.join('data', 'voice_identifications.json')
    if not os.path.exists(id_file):
        print("❌ voice_identifications.json topilmadi")
        sys.exit(1)

    with open(id_file, 'r', encoding='utf-8') as f:
        all_calls = json.load(f)

    # Filter calls identified as Zuhra (or all calls)
    zuhra_calls = [c for c in all_calls if c.get('speaker') in ['zuhra', 'Zuhra opa']]
    print(f"📊 Jami tahlil qilinadigan Zuhra opa qo'ng'iroqlari: {len(zuhra_calls)} ta")

    oybek_pt = os.path.join('data', 'oybek_profile_ensemble.pt')
    zuhra_pt = os.path.join('data', 'zuhra_profile_ensemble.pt')

    if not os.path.exists(oybek_pt) or not os.path.exists(zuhra_pt):
        print("❌ Oybek yoki Zuhra modeli (.pt) topilmadi")
        sys.exit(1)

    oybek_emb = torch.load(oybek_pt)
    zuhra_emb = torch.load(zuhra_pt)

    model_dir = 'tmp_model'
    enc = EncoderClassifier.from_hparams(
        source='speechbrain/spkrec-ecapa-voxceleb',
        savedir=model_dir
    )

    scratch_dir = os.path.join('scratch', 'calls')
    win_sec = 3.5
    step_sec = 3.0
    sr = 16000
    win_samples = int(win_sec * sr)
    step_samples = int(step_sec * sr)

    dual_matches = []
    scanned_count = 0

    for idx, c in enumerate(zuhra_calls):
        fname = c.get('file')
        if not fname:
            continue
        p = os.path.join(scratch_dir, fname)
        if not os.path.exists(p):
            continue

        scanned_count += 1
        try:
            audio = load_audio(p)
            if len(audio) < win_samples:
                continue

            chunks_tensors = []
            chunks_meta = []

            for st in range(0, len(audio) - win_samples, step_samples):
                chk = audio[st:st + win_samples]
                rms = np.sqrt(np.mean(chk**2))
                if rms < 0.035:
                    continue
                chunks_tensors.append(torch.from_numpy(chk).float())
                chunks_meta.append({
                    "start_sec": round(st / sr, 1),
                    "end_sec": round((st + win_samples) / sr, 1),
                    "rms": round(float(rms), 4)
                })

            if not chunks_tensors:
                continue

            # Process in small micro-batches of 8 to keep RAM tiny
            oybek_sims = []
            zuhra_sims = []

            with torch.no_grad():
                for b_idx in range(0, len(chunks_tensors), 8):
                    b = torch.stack(chunks_tensors[b_idx:b_idx + 8], dim=0)
                    embs = enc.encode_batch(b).squeeze(1)
                    s_o = torch.nn.functional.cosine_similarity(embs, oybek_emb.unsqueeze(0), dim=1).tolist()
                    s_z = torch.nn.functional.cosine_similarity(embs, zuhra_emb.unsqueeze(0), dim=1).tolist()
                    oybek_sims.extend(s_o)
                    zuhra_sims.extend(s_z)
                    del b, embs

            max_o = max(oybek_sims) if oybek_sims else 0
            max_z = max(zuhra_sims) if zuhra_sims else 0
            best_o_idx = oybek_sims.index(max_o) if oybek_sims else -1
            best_o_meta = chunks_meta[best_o_idx] if best_o_idx != -1 else {}

            # Record result
            item_res = {
                "file": fname,
                "calldate": c.get('calldate') or c.get('date'),
                "src": c.get('src') or c.get('caller'),
                "dst": c.get('dst') or '119',
                "duration": c.get('duration') or c.get('billsec'),
                "max_oybek_sim": round(max_o, 4),
                "max_zuhra_sim": round(max_z, 4),
                "oybek_segment": best_o_meta,
                "is_dual_candidate": bool(max_o >= 0.60 and max_z >= 0.60)
            }
            dual_matches.append(item_res)

            if max_o >= 0.65:
                print(f"🔥 TOPILDI! [{fname}] da Oybek ovozi aniqlandi: {max_o*100:.1f}% (Zuhra: {max_z*100:.1f}%) vaqti: {best_o_meta.get('start_sec')}s - {best_o_meta.get('end_sec')}s")
            elif (idx + 1) % 15 == 0:
                print(f"  ... tekshirildi: {scanned_count}/{len(zuhra_calls)} ta qo'ng'iroq")

            # Free memory
            del audio, chunks_tensors, chunks_meta, oybek_sims, zuhra_sims
            gc.collect()

        except Exception as e:
            continue

    # Sort by Oybek presence (highest first)
    dual_matches.sort(key=lambda x: x["max_oybek_sim"], reverse=True)

    out_json = os.path.join('data', 'dual_speaker_results.json')
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump(dual_matches, f, indent=2, ensure_ascii=False)

    print("\n" + "="*60)
    print("🏆 OYBEK QATNASHGAN ENG YUQORI EHTIMOLLI QO'NG'IROQLAR (TOP 5):")
    print("="*60)
    for i, m in enumerate(dual_matches[:5]):
        seg = m.get('oybek_segment', {})
        print(f"#{i+1} Fayl: {m['file']}")
        print(f"   Sana: {m['calldate']} | Raqam: {m['src']} | Davomiyligi: {m['duration']} sek")
        print(f"   👤 Oybek mosligi: {m['max_oybek_sim']*100:.1f}% (Vaqti: {seg.get('start_sec')}s - {seg.get('end_sec')}s)")
        print(f"   🌸 Zuhra mosligi: {m['max_zuhra_sim']*100:.1f}%")
        print("-" * 50)

    print(f"\n✅ Natijalar saqlandi: {out_json}")

if __name__ == '__main__':
    main()
