import os
import sys
import json
import soundfile as sf
import numpy as np

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from voice_matcher import VoiceMatcher

def main():
    manifest_path = os.path.join('scratch', 'calls', 'batch_manifest.json')
    if not os.path.exists(manifest_path):
        print("Manifest file not found yet!")
        return

    with open(manifest_path, 'r') as f:
        calls = json.load(f)

    print(f"Loaded {len(calls)} calls from manifest.")
    matcher = VoiceMatcher(model_dir='tmp_model', zuhra_path='zuhra_clean.wav', oper_path='operator.wav')

    results = []
    for idx, c in enumerate(calls):
        local_path = c.get('localPath')
        if not local_path or not os.path.exists(local_path):
            print(f"[{idx+1}/{len(calls)}] File missing: {local_path}")
            continue

        print(f"\n[{idx+1}/{len(calls)}] Tahlil qilinmoqda: {c['calldate']} | {c['src']} ({c['billsec']}s)...", flush=True)
        try:
            # We load audio; for long calls we inspect first 100 seconds
            info = sf.info(local_path)
            sr = info.samplerate
            max_frames = min(info.frames, int(sr * 100))
            audio_data, file_sr = sf.read(local_path, frames=max_frames)
            
            # Run analysis
            analysis = matcher.analyze_call(
                wav_path=audio_data,
                sr=file_sr,
                window_sec=2.5,
                step_sec=2.0,
                oper_threshold=0.55
            )

            # Combine with CDR metadata
            res_item = {
                'calldate': c['calldate'],
                'src': c['src'],
                'dst': c['dst'],
                'billsec': c['billsec'],
                'file': c['recBase'],
                'max_zuhra_score': analysis['max_zuhra_score'],
                'avg_top_zuhra_score': analysis['avg_top_zuhra_score'],
                'zuhra_match_count': analysis['zuhra_match_count'],
                'oper_segments': analysis['oper_segments'],
                'non_oper_segments': analysis['non_oper_segments'],
                'is_zuhra_detected': analysis['is_zuhra_detected'],
                'top_segments': analysis['top_segments'] if 'top_segments' in analysis else analysis.get('top_zuhra_segments', [])
            }
            results.append(res_item)

            status = "[ZUHRA DETECTED]" if res_item['is_zuhra_detected'] else "[MUATTAR/CLIENT]"
            print(f"  -> Natija: {status} | Max ball: {res_item['max_zuhra_score']} | Zuhra segmentlari: {res_item['zuhra_match_count']}", flush=True)

        except Exception as e:
            print(f"  -> Xatolik: {e}", flush=True)

    # Sort descending by max_zuhra_score
    results.sort(key=lambda x: (x['is_zuhra_detected'], x['max_zuhra_score']), reverse=True)

    out_file = os.path.join('scratch', 'batch_scan_report.json')
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print("\n" + "="*80, flush=True)
    print("=== TAHLIL NATIJALARI (SARALANGAN RO'YXAT) ===", flush=True)
    print("="*80, flush=True)
    print(f"{'Sana & Vaqt':<22} | {'Mijoz':<12} | {'Davomiyligi':<10} | {'Max Ball':<9} | {'Zuhra Seg':<9} | {'Xulosa':<15}", flush=True)
    print("-" * 85, flush=True)
    for r in results:
        status = "[ANIQ ZUHRA]" if r['max_zuhra_score'] >= 0.60 or r['zuhra_match_count'] >= 4 else ("[EHTIMOL]" if r['max_zuhra_score'] >= 0.50 else "[Muattar]")
        print(f"{r['calldate']:<22} | {r['src']:<12} | {str(r['billsec']) + 's':<10} | {r['max_zuhra_score']:<9.3f} | {r['zuhra_match_count']:<9} | {status:<15}", flush=True)

if __name__ == '__main__':
    main()
