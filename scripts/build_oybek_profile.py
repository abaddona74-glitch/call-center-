import os
import sys
import json
import torch
import soundfile as sf
import numpy as np
from scipy import signal
from speechbrain.inference.speaker import EncoderClassifier

# Suppress warnings
import warnings
warnings.filterwarnings('ignore')

sys.stdout.reconfigure(encoding='utf-8')

def load_audio(path, target_sr=16000):
    data, sr = sf.read(path)
    if len(data.shape) > 1:
        data = data.mean(axis=1)
    if sr != target_sr:
        num_samples = int(len(data) * target_sr / sr)
        data = signal.resample(data, num_samples)
    return data.astype(np.float32)

def main():
    db_path = os.path.join('data', 'oybek_samples.json')
    if not os.path.exists(db_path):
        print(json.dumps({"success": False, "error": "oybek_samples.json topilmadi"}))
        sys.exit(0)

    try:
        with open(db_path, 'r', encoding='utf-8') as f:
            samples = json.load(f)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"JSON o'qishda xatolik: {str(e)}"}))
        sys.exit(0)

    approved = [s for s in samples if s.get('status') == 'approved']
    if not approved:
        # User hasn't approved any Oybek samples yet
        print(json.dumps({
            "success": False, 
            "error": "Hali birorta ham Oybek namunalari tasdiqlanmagan. Iltimos, audio parchalarni eshitib 'Oybek ovozi' tugmasi bilan tasdiqlang."
        }))
        sys.exit(0)

    model_dir = 'tmp_model'
    enc = EncoderClassifier.from_hparams(
        source='speechbrain/spkrec-ecapa-voxceleb',
        savedir=model_dir
    )

    all_embs = []
    sample_dir = os.path.join('public', 'samples', 'oybek')

    for s in approved:
        fname = s.get('file')
        if not fname:
            continue
        p = os.path.join(sample_dir, fname)
        if os.path.exists(p):
            audio = load_audio(p)
            t = torch.from_numpy(audio).float().unsqueeze(0)
            emb = enc.encode_batch(t).squeeze()
            all_embs.append(emb)

    if not all_embs:
        print(json.dumps({"success": False, "error": "Tasdiqlangan namunalarning audio fayllari topilmadi"}))
        sys.exit(0)

    # Stack and calculate unit-normalized centroid (mean embedding)
    stacked = torch.stack(all_embs, dim=0)
    ensemble_emb = torch.mean(stacked, dim=0)
    ensemble_emb = torch.nn.functional.normalize(ensemble_emb, p=2, dim=0)

    out_pt = os.path.join('data', 'oybek_profile_ensemble.pt')
    torch.save(ensemble_emb, out_pt)

    res = {
        "success": True,
        "approved_count": len(approved),
        "total_embeddings": len(all_embs),
        "ensemble_file": out_pt,
        "message": f"Oybek (101) ovoz modeli {len(all_embs)} ta tasdiqlangan namunalar bilan kuchaytirildi!"
    }
    print(json.dumps(res, ensure_ascii=False))

if __name__ == '__main__':
    main()
