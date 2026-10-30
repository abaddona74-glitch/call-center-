import os
import sys
import json
import soundfile as sf
import numpy as np

sys.stdout.reconfigure(encoding='utf-8')

def normalize_audio(audio, target_peak=0.9):
    peak = np.max(np.abs(audio))
    if peak > 1e-4:
        return audio * (target_peak / peak)
    return audio

def main():
    calls_dir = os.path.join('scratch', 'calls')
    out_dir = os.path.join('public', 'samples', 'candidates')
    os.makedirs(out_dir, exist_ok=True)

    candidates = [
        # 5 Manual Overrides (User Confirmed Calls)
        {
            "id": "sample_1",
            "caller_id": "909127798",
            "calldate": "2026-09-18 12:38:50",
            "file": "q-2020159-909127798-20260918-123844-1789717116.147858.wav",
            "start": 50.0,
            "duration": 3.0,
            "zuhra_score": 0.4764,
            "source_type": "manual_override",
            "description": "Foydalanuvchi tasdiqlagan (18-Sentabr)"
        },
        {
            "id": "sample_2",
            "caller_id": "948509897",
            "calldate": "2026-09-18 11:12:51",
            "file": "q-2020159-948509897-20260918-111244-1789711957.145423.wav",
            "start": 46.0,
            "duration": 3.0,
            "zuhra_score": 0.4423,
            "source_type": "manual_override",
            "description": "Foydalanuvchi tasdiqlagan (18-Sentabr)"
        },
        {
            "id": "sample_3",
            "caller_id": "555170055",
            "calldate": "2026-09-18 15:48:51",
            "file": "q-2020159-555170055-20260918-154845-1789728518.172751.wav",
            "start": 14.0,
            "duration": 3.0,
            "zuhra_score": 0.5055,
            "source_type": "manual_override",
            "description": "Foydalanuvchi tasdiqlagan (18-Sentabr)"
        },
        {
            "id": "sample_4",
            "caller_id": "944138877",
            "calldate": "2026-09-18 10:19:29",
            "file": "q-2020159-944138877-20260918-101826-1789708699.142165.wav",
            "start": 40.0,
            "duration": 3.0,
            "zuhra_score": 0.4531,
            "source_type": "manual_override",
            "description": "Foydalanuvchi tasdiqlagan (18-Sentabr)"
        },
        {
            "id": "sample_5",
            "caller_id": "935230458",
            "calldate": "2026-09-18 10:56:57",
            "file": "q-2020159-935230458-20260918-105651-1789711004.144461.wav",
            "start": 22.0,
            "duration": 3.0,
            "zuhra_score": 0.3929,
            "source_type": "manual_override",
            "description": "Foydalanuvchi tasdiqlagan (18-Sentabr)"
        },
        # 5 Top AI Zuhra Detections (High Score Candidates to verify)
        {
            "id": "sample_6",
            "caller_id": "938939833",
            "calldate": "2026-08-24 16:28:45",
            "file": "q-2020159-938939833-20260824-162845-1787570918.143837.wav",
            "start": 42.0,
            "duration": 3.0,
            "zuhra_score": 0.6303,
            "source_type": "ai_detected",
            "description": "AI reytingi eng yuqori (63% o'xshashlik)"
        },
        {
            "id": "sample_7",
            "caller_id": "951677131",
            "calldate": "2026-08-17 15:03:25",
            "file": "q-2020159-951677131-20260817-150325-1786960998.3664.wav",
            "start": 68.0,
            "duration": 3.0,
            "zuhra_score": 0.6166,
            "source_type": "ai_detected",
            "description": "AI reytingi yuqori (62% o'xshashlik)"
        },
        {
            "id": "sample_8",
            "caller_id": "712077377",
            "calldate": "2026-09-18 11:30:53",
            "file": "q-2020159-712077377-20260918-113053-1789713045.146274.wav",
            "start": 54.0,
            "duration": 3.0,
            "zuhra_score": 0.6145,
            "source_type": "ai_detected",
            "description": "AI reytingi yuqori (61% o'xshashlik)"
        },
        {
            "id": "sample_9",
            "caller_id": "978850526",
            "calldate": "2026-08-27 09:58:54",
            "file": "q-2020159-978850526-20260827-095854-1787806726.642856.wav",
            "start": 34.0,
            "duration": 3.0,
            "zuhra_score": 0.6121,
            "source_type": "ai_detected",
            "description": "AI reytingi yuqori (61% o'xshashlik)"
        },
        {
            "id": "sample_10",
            "caller_id": "903295367",
            "calldate": "2026-08-24 15:40:47",
            "file": "q-2020159-903295367-20260824-154047-1787568040.139167.wav",
            "start": 20.0,
            "duration": 3.0,
            "zuhra_score": 0.6050,
            "source_type": "ai_detected",
            "description": "AI reytingi yuqori (60% o'xshashlik)"
        }
    ]

    output_list = []

    for c in candidates:
        filepath = os.path.join(calls_dir, c["file"])
        if not os.path.exists(filepath):
            print(f"⚠️ Fayl yo'q: {filepath}")
            continue

        info = sf.info(filepath)
        sr = info.samplerate
        start_frame = int(c["start"] * sr)
        frames_to_read = int(c["duration"] * sr)

        data, _ = sf.read(filepath, start=start_frame, stop=start_frame + frames_to_read)
        if len(data.shape) > 1:
            data = data.mean(axis=1)

        norm_data = normalize_audio(data, target_peak=0.92)

        out_name = f"{c['id']}.wav"
        out_path = os.path.join(out_dir, out_name)
        sf.write(out_path, norm_data, sr)

        t_end = c["start"] + c["duration"]
        start_str = f"{int(c['start'] // 60):02d}:{int(c['start'] % 60):02d}"
        end_str = f"{int(t_end // 60):02d}:{int(t_end % 60):02d}"

        output_list.append({
            "id": c["id"],
            "filename": out_name,
            "audio_url": f"/samples/candidates/{out_name}",
            "caller_id": c["caller_id"],
            "calldate": c["calldate"],
            "source_call": c["file"],
            "start_sec": c["start"],
            "end_sec": t_end,
            "time_range": f"{start_str} — {end_str}",
            "duration_sec": c["duration"],
            "similarity_score": c["zuhra_score"],
            "source_type": c["source_type"],
            "description": c["description"],
            "status": "pending",
            "reviewed_at": None
        })
        print(f"✅ Kesildi: {c['id']} -> {out_name} ({start_str} - {end_str})")

    db_path = os.path.join('data', 'voice_candidate_samples.json')
    with open(db_path, 'w', encoding='utf-8') as f:
        json.dump(output_list, f, indent=2, ensure_ascii=False)

    print(f"\n🎉 Jami {len(output_list)} ta namuna muvaffaqiyatli saqlandi: {db_path}")

if __name__ == '__main__':
    main()
