import os
import sys
import json
import torch
import soundfile as sf
import numpy as np
from scipy import signal
from speechbrain.inference.speaker import EncoderClassifier

def load_audio(path, max_sec=75.0, target_sr=16000):
    data, sr = sf.read(path)
    if len(data.shape) > 1:
        data = data.mean(axis=1)
    
    # Truncate to max_sec BEFORE resampling!
    max_orig = int(max_sec * sr)
    if len(data) > max_orig:
        data = data[:max_orig]

    # Resample only the truncated slice to 16kHz
    if sr != target_sr:
        num_samples = int(len(data) * target_sr / sr)
        data = signal.resample(data, num_samples)
        sr = target_sr

    return data.astype(np.float32), target_sr

def normalize_audio(audio, target_peak=0.9):
    peak = np.max(np.abs(audio))
    if peak > 1e-4:
        return audio * (target_peak / peak)
    return audio

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No input JSON provided"}))
        sys.exit(1)

    input_json_path = sys.argv[1]
    with open(input_json_path, 'r', encoding='utf-8') as f:
        tasks = json.load(f)

    model_dir = 'tmp_model'
    enc = EncoderClassifier.from_hparams(
        source='speechbrain/spkrec-ecapa-voxceleb',
        savedir=model_dir
    )

    zuhra_clean_data, _ = load_audio('zuhra_clean.wav', max_sec=60.0)
    oper_clean_data, _ = load_audio('operator.wav', max_sec=60.0)

    zuhra_emb = enc.encode_batch(torch.from_numpy(zuhra_clean_data).float().unsqueeze(0)).squeeze()
    oper_emb = enc.encode_batch(torch.from_numpy(oper_clean_data).float().unsqueeze(0)).squeeze()

    out_dir = os.path.join('public', 'samples', 'candidates')
    os.makedirs(out_dir, exist_ok=True)

    results = []
    window_sec = 3.0
    step_sec = 0.5
    target_sr = 16000
    win_samples = int(window_sec * target_sr)
    step_samples = int(step_sec * target_sr)

    for idx, t in enumerate(tasks):
        wav_path = t['localPath']
        if not os.path.exists(wav_path):
            continue

        try:
            data, sr = load_audio(wav_path, max_sec=75.0, target_sr=target_sr)
        except Exception as e:
            continue

        if len(data) < win_samples:
            continue

        chunks = []
        meta = []
        for start in range(0, len(data) - win_samples, step_samples):
            chunk = data[start:start + win_samples]
            rms = np.sqrt(np.mean(chunk**2))
            if rms < 0.015:
                continue
            chunks.append(chunk)
            t_start = start / target_sr
            t_end = (start + win_samples) / target_sr
            meta.append((t_start, t_end, float(rms), chunk))

        if not chunks:
            continue

        # Process in small mini-batch
        batch = torch.from_numpy(np.array(chunks)).float()
        with torch.no_grad():
            embs = enc.encode_batch(batch)
            if embs.dim() == 3 and embs.size(1) == 1:
                embs = embs.squeeze(1)

            sim_zuhra = torch.nn.functional.cosine_similarity(embs, zuhra_emb.unsqueeze(0), dim=-1).cpu().numpy()
            sim_oper = torch.nn.functional.cosine_similarity(embs, oper_emb.unsqueeze(0), dim=-1).cpu().numpy()

        best_score = -999.0
        best_meta = None
        best_sim_z = 0.0
        best_sim_o = 0.0

        for i in range(len(chunks)):
            t_start, t_end, rms_val, raw_chunk = meta[i]
            sz = float(sim_zuhra[i])
            so = float(sim_oper[i])

            # Prefer high Zuhra, low Muattar, good energy
            oper_penalty = 1.0 if so > 0.48 else 0.0
            score = sz - (0.5 * so) - (oper_penalty * 0.4) + (min(rms_val, 0.08) * 0.5)

            if score > best_score:
                best_score = score
                best_meta = (t_start, t_end, rms_val, raw_chunk)
                best_sim_z = sz
                best_sim_o = so

        if best_meta:
            t_start, t_end, rms_val, raw_chunk = best_meta
            norm_chunk = normalize_audio(raw_chunk)

            sample_id = f"sample_{idx + 1}"
            sample_filename = f"{sample_id}.wav"
            out_file = os.path.join(out_dir, sample_filename)
            sf.write(out_file, norm_chunk, target_sr)

            results.append({
                "id": sample_id,
                "file": sample_filename,
                "url": f"/samples/candidates/{sample_filename}",
                "caller_id": t.get("caller_id", ""),
                "calldate": t.get("calldate", ""),
                "source_call": os.path.basename(wav_path),
                "start_sec": round(t_start, 1),
                "end_sec": round(t_end, 1),
                "time_range": f"{int(t_start // 60):02d}:{int(t_start % 60):02d} — {int(t_end // 60):02d}:{int(t_end % 60):02d}",
                "duration_sec": 3.0,
                "zuhra_score": round(best_sim_z, 4),
                "oper_score": round(best_sim_o, 4),
                "rms": round(rms_val, 4),
                "source_type": t.get("source_type", "manual_override"),
                "status": "pending",
                "reviewed_at": None
            })

    output_db = os.path.join('data', 'voice_candidate_samples.json')
    with open(output_db, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(json.dumps(results, indent=2))

if __name__ == '__main__':
    main()
