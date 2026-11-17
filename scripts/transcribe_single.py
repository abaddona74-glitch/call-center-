import os
import sys
import json
import time
import math
import soundfile as sf
import numpy as np
import torch
from scipy import signal

# Utilize 6 CPU threads (i5-10400 has 6 physical cores, 12 logical threads)
# Leaves 6 threads completely free for PBX, Web server, and background services
torch.set_num_threads(6)

def clean_uzbek_text(raw_text):
    if not raw_text:
        return ""
    text = " ".join(raw_text.strip().split())
    if len(text) > 1:
        text = text[0].upper() + text[1:]
    return text

def transcribe_audio(audio_path, max_duration_sec=3600):
    start_time = time.time()
    
    if not os.path.exists(audio_path):
        return {"success": False, "error": f"Fayl topilmadi: {audio_path}"}

    sys.stderr.write(f"[STT] Audioni o'qish boshlandi: {audio_path}\n")
    sys.stderr.flush()

    try:
        data, sr = sf.read(audio_path)
    except Exception as e:
        return {"success": False, "error": f"Audioni o'qishda xatolik: {str(e)}"}

    if len(data.shape) > 1:
        data = data.mean(axis=1)

    # Ultra-fast polyphase resampling to 16kHz (0.3s for 14min instead of 30s FFT)
    if sr != 16000:
        g = math.gcd(16000, sr)
        up = 16000 // g
        down = sr // g
        data = signal.resample_poly(data, up, down)
        sr = 16000

    data = data.astype(np.float32)
    total_audio_sec = len(data) / 16000.0

    sys.stderr.write(f"[STT] Audio davomiyligi: {total_audio_sec:.1f} soniya ({total_audio_sec/60:.1f} daqiqa)\n")
    sys.stderr.flush()

    if total_audio_sec > max_duration_sec:
        data = data[:int(max_duration_sec * 16000)]

    sys.stderr.write("[STT] Model yuklanmoqda...\n")
    sys.stderr.flush()

    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

    model_name = "AlexAnoshka/wav2vec2-xls-r-uzbek-cv8"
    processor = Wav2Vec2Processor.from_pretrained(model_name)
    raw_model = Wav2Vec2ForCTC.from_pretrained(model_name)
    raw_model.eval()

    # Dynamic INT8 Quantization: ~2x speedup and 50% less RAM on modern x86 CPU with AVX2
    sys.stderr.write("[STT] INT8 optimizatsiyasi qo'llanmoqda...\n")
    sys.stderr.flush()
    model = torch.quantization.quantize_dynamic(
        raw_model, {torch.nn.Linear}, dtype=torch.qint8
    )
    model.eval()

    sys.stderr.write("[STT] Model tayyor (6 threads, INT8). Transkripsiya boshlandi...\n")
    sys.stderr.flush()

    chunk_len = 30 * 16000
    stride = 30 * 16000
    
    transcriptions = []
    total_len = len(data)
    
    with torch.inference_mode():
        for start in range(0, total_len, stride):
            end = min(start + chunk_len, total_len)
            chunk = data[start:end]
            
            # Skip chunks that are pure silence (low energy)
            energy = np.mean(chunk ** 2)
            if energy < 0.00008:
                continue
                
            inputs = processor(chunk, sampling_rate=16000, return_tensors="pt")
            logits = model(inputs.input_values).logits
            predicted_ids = torch.argmax(logits, dim=-1)
            transcription = processor.batch_decode(predicted_ids)[0]
            if transcription and transcription.strip():
                transcriptions.append(transcription.strip())

    full_text = clean_uzbek_text(" ".join(transcriptions))
    elapsed = round(time.time() - start_time, 2)
    speed_factor = round(total_audio_sec / max(elapsed, 0.01), 1)

    sys.stderr.write(f"[STT] Tugadi: {elapsed} soniya ({speed_factor}x real-time)\n")
    sys.stderr.flush()

    return {
        "success": True,
        "text": full_text if full_text else "(Suhbat matni aniqlanmadi yoki jimlik)",
        "duration_sec": round(total_audio_sec, 1),
        "elapsed_sec": elapsed,
        "speed_factor": speed_factor
    }

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Fayl yo'li berilmadi"}))
        sys.exit(1)
        
    audio_path = sys.argv[1]
    res = transcribe_audio(audio_path)
    print(json.dumps(res, ensure_ascii=False))
