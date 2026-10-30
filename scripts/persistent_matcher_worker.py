import os
import sys
import json
import soundfile as sf
import numpy as np

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from voice_matcher import VoiceMatcher

def main():
    # Force utf-8 stdout
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stdin.reconfigure(encoding='utf-8')

    model_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tmp_model')
    zuhra_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'zuhra_clean.wav')
    oper_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'operator.wav')

    # Redirect stderr for info
    sys.stderr.write("Loading matcher in worker...\n")
    sys.stderr.flush()

    matcher = VoiceMatcher(model_dir=model_dir, zuhra_path=zuhra_path, oper_path=oper_path)
    sys.stdout.write("READY\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line == "EXIT":
            break

        try:
            req = json.loads(line)
            local_path = req['localPath']
            
            if not os.path.exists(local_path):
                print(json.dumps({'error': f'File not found: {local_path}'}), flush=True)
                continue

            info = sf.info(local_path)
            sr = info.samplerate
            # Inspect first 60 seconds (operator greeting & conversation)
            max_frames = min(info.frames, int(sr * 60))
            audio_data, file_sr = sf.read(local_path, frames=max_frames)

            analysis = matcher.analyze_call(
                wav_path=audio_data,
                sr=file_sr,
                window_sec=2.5,
                step_sec=2.0,
                oper_threshold=0.55
            )

            is_zuhra = analysis['is_zuhra_detected']
            max_score = analysis['max_zuhra_score']
            confidence = int(round(max_score * 100)) if max_score > 0 else 0

            res = {
                'success': True,
                'file': req.get('recBase', os.path.basename(local_path)),
                'uniqueid': req.get('uniqueid', ''),
                'caller_id': req.get('src', ''),
                'calldate': req.get('calldate', ''),
                'duration': int(req.get('billsec', 0)),
                'speaker': 'zuhra' if is_zuhra else 'muattar',
                'speaker_name': 'Zuhra opa' if is_zuhra else 'Muattar',
                'score': round(max_score, 4),
                'zuhra_segments': analysis.get('zuhra_match_count', 0),
                'confidence': confidence,
                'top_segments': [
                    {
                        'start': s['start'],
                        'end': s['end'],
                        'rms': s['rms'],
                        'sim_oper': s['sim_oper'],
                        'sim_zuhra': s['sim_zuhra'],
                        'is_oper': s['is_oper']
                    }
                    for s in analysis.get('top_zuhra_segments', [])[:3]
                ]
            }
            print(json.dumps(res, ensure_ascii=False), flush=True)

        except Exception as e:
            print(json.dumps({'error': str(e)}), flush=True)

if __name__ == '__main__':
    main()
