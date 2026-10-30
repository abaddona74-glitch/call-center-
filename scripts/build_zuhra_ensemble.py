import os
import sys
import json
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
        num_samples = int(len(data) * target_sr / sr)
        data = signal.resample(data, num_samples)
        sr = target_sr
    return data.astype(np.float32)

def main():
    model_dir = 'tmp_model'
    enc = EncoderClassifier.from_hparams(
        source='speechbrain/spkrec-ecapa-voxceleb',
        savedir=model_dir
    )

    db_path = os.path.join('data', 'voice_candidate_samples.json')
    if not os.path.exists(db_path):
        print(json.dumps({"success": False, "error": "voice_candidate_samples.json topilmadi"}))
        sys.exit(1)

    with open(db_path, 'r', encoding='utf-8') as f:
        samples = json.load(f)

    approved = [s for s in samples if s.get('status') == 'approved']
    if not approved:
        print(json.dumps({"success": False, "error": "Tasdiqlangan namunalar topilmadi"}))
        sys.exit(1)

    print(f"Tasdiqlangan {len(approved)} ta namuna asosida AI profilini yangilash boshlandi...")

    # Load baseline zuhra_clean.wav
    baseline_data = load_audio('zuhra_clean.wav')
    baseline_emb = enc.encode_batch(torch.from_numpy(baseline_data).float().unsqueeze(0)).squeeze()

    all_embs = [baseline_emb]

    for item in approved:
        fname = item.get('filename') or item.get('file')
        wav_path = os.path.join('public', 'samples', 'candidates', fname)
        if os.path.exists(wav_path):
            audio = load_audio(wav_path)
            t = torch.from_numpy(audio).float().unsqueeze(0)
            emb = enc.encode_batch(t).squeeze()
            all_embs.append(emb)
            print(f"  + Qo'shildi: {item['id']} ({fname})")

    # Stack and calculate unit-normalized centroid (mean embedding)
    stacked = torch.stack(all_embs, dim=0)
    ensemble_emb = torch.mean(stacked, dim=0)
    ensemble_emb = torch.nn.functional.normalize(ensemble_emb, p=2, dim=0)

    out_pt = os.path.join('data', 'zuhra_profile_ensemble.pt')
    torch.save(ensemble_emb, out_pt)

    # Check similarity with original clean voiceprint
    sim_original = torch.nn.functional.cosine_similarity(baseline_emb, ensemble_emb, dim=0).item()
    print(f"\n✅ Yangi kompozit ovoz profili saqlandi: {out_pt}")
    print(f"Boshlang'ich etalon bilan o'xshashlik: {sim_original:.4f}")

    res = {
        "success": True,
        "approved_count": len(approved),
        "total_embeddings": len(all_embs),
        "similarity_to_clean": round(sim_original, 4),
        "ensemble_file": out_pt
    }
    print(json.dumps(res))

if __name__ == '__main__':
    main()
