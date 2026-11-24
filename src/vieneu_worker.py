"""VieNeu-TTS worker for demo-studio: loads the model once, then serves JSON lines.

stdin : {"id": 1, "text": "...", "voice": "Mai Anh", "out": "/path.wav", "temperature": 0.8}
stdout: {"id": 1, "ok": true} | {"id": 1, "ok": false, "error": "..."}; first line {"ready": true, "voices": [...]}
Runs torch-free on CPU (ONNX Runtime). Env: VIENEU_PRECISION=fp32|int8.
"""
import json
import os
import sys

def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()

def main():
    # Model download/load chatter goes to stderr so stdout stays a clean protocol.
    real_stdout = sys.stdout
    sys.stdout = sys.stderr
    from vieneu import Vieneu
    precision = os.environ.get("VIENEU_PRECISION", "fp32")
    tts = Vieneu(precision=precision) if precision != "fp32" else Vieneu()
    voices = []
    try:
        voices = [label for label, _ in tts.list_preset_voices()]
    except Exception:
        pass
    sys.stdout = real_stdout
    emit({"ready": True, "voices": voices, "precision": precision})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        try:
            sys.stdout = sys.stderr
            kw = {}
            if req.get("voice"):
                kw["voice"] = req["voice"]
            if req.get("temperature") is not None:
                kw["temperature"] = float(req["temperature"])
            audio = tts.infer(req["text"], **kw)
            tts.save(audio, req["out"])
            sys.stdout = real_stdout
            emit({"id": req.get("id"), "ok": True})
        except Exception as e:  # report and keep serving
            sys.stdout = real_stdout
            emit({"id": req.get("id"), "ok": False, "error": f"{type(e).__name__}: {e}"})

if __name__ == "__main__":
    main()
