import os
import torch
import soundfile as sf
import numpy as np
from scipy import signal
from speechbrain.inference.speaker import EncoderClassifier

class VoiceMatcher:
    def __init__(self, model_dir='tmp_model', zuhra_path='zuhra_clean.wav', oper_path='operator.wav'):
        print("Loading SpeechBrain ECAPA model...")
        self.enc = EncoderClassifier.from_hparams(
            source='speechbrain/spkrec-ecapa-voxceleb', 
            savedir=model_dir
        )
        ensemble_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'zuhra_profile_ensemble.pt')
        if os.path.exists(ensemble_path):
            try:
                self.zuhra_emb = torch.load(ensemble_path, map_location='cpu')
                print(f"Loaded ENSEMBLE reference voiceprint from {ensemble_path}!")
            except Exception as e:
                self.zuhra_emb = self.get_file_embedding(zuhra_path)
        else:
            self.zuhra_emb = self.get_file_embedding(zuhra_path)

        self.oper_emb = self.get_file_embedding(oper_path)
        print("Loaded reference voiceprints: Zuhra & Operator (Muattar)")
        
        sim = torch.nn.functional.cosine_similarity(self.zuhra_emb, self.oper_emb, dim=0).item()
        print(f"Reference distance: Cosine similarity between Zuhra and Muattar: {sim:.4f}")

    def load_audio(self, path_or_data, sr=None):
        if isinstance(path_or_data, str):
            data, sr = sf.read(path_or_data)
        else:
            data = path_or_data

        if len(data.shape) > 1:
            data = data.mean(axis=1)

        # Resample to 16kHz
        if sr != 16000:
            num_samples = int(len(data) * 16000 / sr)
            data = signal.resample(data, num_samples)
            sr = 16000

        return data.astype(np.float32), 16000

    def get_file_embedding(self, path):
        data, sr = self.load_audio(path)
        t = torch.from_numpy(data).float().unsqueeze(0)
        return self.enc.encode_batch(t).squeeze()

    def analyze_call(self, wav_path, sr=None, window_sec=2.5, step_sec=1.0, oper_threshold=0.55):
        """
        Analyzes a call recording:
        1. Breaks audio into sliding windows
        2. Filters out silent / low energy segments
        3. Computes embeddings
        4. Identifies Operator (Muattar) and skips
        5. Computes Zuhra similarity for remaining segments
        """
        data, sr = self.load_audio(wav_path, sr=sr)
        duration = len(data) / sr

        win_samples = int(window_sec * sr)
        step_samples = int(step_sec * sr)

        chunk_list = []
        meta_list = []
        for start in range(0, len(data) - win_samples, step_samples):
            chunk = data[start:start + win_samples]
            # Energy check (skip silence)
            rms = np.sqrt(np.mean(chunk**2))
            if rms < 0.015:
                continue
            chunk_list.append(chunk)
            t_start = round(start / sr, 1)
            t_end = round((start + win_samples) / sr, 1)
            meta_list.append((t_start, t_end, round(float(rms), 4)))

        segments = []
        if chunk_list:
            batch = torch.from_numpy(np.array(chunk_list)).float()
            # Vectorized batch embedding pass (takes ~0.1s instead of 3.5s)
            embs = self.enc.encode_batch(batch)
            if embs.dim() == 3 and embs.size(1) == 1:
                embs = embs.squeeze(1)
            
            sim_oper_all = torch.nn.functional.cosine_similarity(embs, self.oper_emb.unsqueeze(0), dim=-1).cpu().numpy()
            sim_zuhra_all = torch.nn.functional.cosine_similarity(embs, self.zuhra_emb.unsqueeze(0), dim=-1).cpu().numpy()

            for i in range(len(chunk_list)):
                t_start, t_end, rms_val = meta_list[i]
                sim_oper = round(float(sim_oper_all[i]), 4)
                sim_zuhra = round(float(sim_zuhra_all[i]), 4)
                is_oper = sim_oper >= oper_threshold
                segments.append({
                    'start': t_start,
                    'end': t_end,
                    'rms': rms_val,
                    'sim_oper': sim_oper,
                    'sim_zuhra': sim_zuhra,
                    'is_oper': is_oper
                })

        non_oper = [s for s in segments if not s['is_oper']]
        zuhra_matches = [s for s in non_oper if s['sim_zuhra'] >= 0.50]

        max_zuhra = max([s['sim_zuhra'] for s in non_oper], default=0.0)
        top_5_scores = sorted([s['sim_zuhra'] for s in non_oper], reverse=True)[:5]
        avg_top_zuhra = round(float(np.mean(top_5_scores)), 4) if top_5_scores else 0.0

        return {
            'file': os.path.basename(wav_path) if isinstance(wav_path, str) else 'audio_stream',
            'duration': round(duration, 1),
            'total_active_segments': len(segments),
            'oper_segments': len([s for s in segments if s['is_oper']]),
            'non_oper_segments': len(non_oper),
            'zuhra_match_count': len(zuhra_matches),
            'max_zuhra_score': round(max_zuhra, 4),
            'avg_top_zuhra_score': avg_top_zuhra,
            'is_zuhra_detected': len(zuhra_matches) >= 3 or max_zuhra >= 0.60,
            'top_zuhra_segments': sorted(non_oper, key=lambda x: x['sim_zuhra'], reverse=True)[:5]
        }

if __name__ == '__main__':
    matcher = VoiceMatcher()
    print("Testing on zuhra_clean.wav (should be ~1.0):")
    res = matcher.analyze_call('zuhra_clean.wav')
    print("Result:", res)
    print("\nTesting on operator.wav (should NOT detect Zuhra):")
    res2 = matcher.analyze_call('operator.wav')
    print("Result:", res2)
