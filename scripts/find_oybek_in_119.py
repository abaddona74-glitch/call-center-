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
    return data.astype(np.float32), 16000

def get_speech_segments(audio_data, sr=16000, seg_len_sec=3.0, step_sec=2.0):
    seg_samples = int(seg_len_sec * sr)
    step_samples = int(step_sec * sr)
    total_len = len(audio_data)
    
    segments = []
    for start in range(0, total_len - seg_samples, step_samples):
        chunk = audio_data[start:start + seg_samples]
        rms = np.sqrt(np.mean(chunk**2))
        zcr = np.mean(np.abs(np.diff(np.sign(chunk)))) / 2
        if rms > 0.015 and zcr > 0.02:
            segments.append((start / sr, chunk))
    return segments

def main():
    print("🔍 119-raqamdagi qo'ng'iroqlar ichidan OYBEK ovozini qidirish boshlandi...")
    
    oybek_model_path = os.path.join('data', 'oybek_profile_ensemble.pt')
    if not os.path.exists(oybek_model_path):
        print("❌ data/oybek_profile_ensemble.pt topilmadi!")
        sys.exit(1)

    oybek_emb = torch.load(oybek_model_path, map_location='cpu')
    if len(oybek_emb.shape) == 1:
        oybek_emb = oybek_emb.unsqueeze(0)

    model_dir = 'tmp_model'
    enc = EncoderClassifier.from_hparams(
        source='speechbrain/spkrec-ecapa-voxceleb',
        savedir=model_dir
    )

    ids_file = os.path.join('data', 'voice_identifications.json')
    with open(ids_file, 'r', encoding='utf-8') as f:
        calls = json.load(f)

    # 17-Aug to 19-Sep
    in_range = [c for c in calls if '2026-08-17' <= c.get('calldate', '') <= '2026-09-19 23:59:59']
    
    # Zuhra deb topilganlar va uzoq davom etgan qo'ng'iroqlar eng yuqori ehtimol
    zuhra_calls = [c for c in in_range if c.get('speaker') in ['zuhra', 'Zuhra opa']]
    print(f"Oraliqdagi jami Zuhra qo'ng'iroqlari: {len(zuhra_calls)} ta")

    results = []
    print(f"Tahlil qilinmoqda...")

    calls_dir = os.path.join('scratch', 'calls')

    # We will test against locally existing or sample calls
    # Or write a streaming scanner
    
if __name__ == '__main__':
    main()
