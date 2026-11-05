"""NEXUS art generation — Z-Image-Turbo (Apache-2.0) local on RTX 3060 12 GB.

Two phases so peak VRAM stays under 12 GB:
  1. Qwen3 text encoder (bf16) encodes every prompt, then is freed.
  2. Q8_0 GGUF transformer + VAE denoise from the cached embeddings.

Usage: python gen.py <job.json>
job = {"out": dir, "width": W, "height": H, "steps": 9,
       "items": [{"name": str, "prompt": str, "seeds": [int, ...]}]}
"""
import gc, json, os, sys, time
import torch

os.environ.setdefault("HF_HOME", r"D:\nexus-artgen\hf")
from diffusers import ZImagePipeline, ZImageTransformer2DModel, GGUFQuantizationConfig

REPO = "Tongyi-MAI/Z-Image-Turbo"
GGUF = r"D:\nexus-artgen\models\z-image-turbo-Q8_0.gguf"

job = json.load(open(sys.argv[1], encoding="utf-8"))
os.makedirs(job["out"], exist_ok=True)
dt = torch.bfloat16

# ── Phase 1: text encoding ──
pipe = ZImagePipeline.from_pretrained(REPO, transformer=None, torch_dtype=dt)
pipe.text_encoder.to("cuda")
embeds = {}
with torch.no_grad():
    for it in job["items"]:
        pe, _ = pipe.encode_prompt(prompt=it["prompt"], device="cuda", do_classifier_free_guidance=False)
        embeds[it["name"]] = [e.to("cpu") for e in pe]
pipe.text_encoder.to("cpu")
del pipe.text_encoder
pipe.text_encoder = None
gc.collect(); torch.cuda.empty_cache()

# ── Phase 2: denoise ──
tr = ZImageTransformer2DModel.from_single_file(
    GGUF,
    quantization_config=GGUFQuantizationConfig(compute_dtype=dt),
    config=REPO, subfolder="transformer", torch_dtype=dt,
)
pipe.transformer = tr
pipe.to("cuda")
W, H, steps = job["width"], job["height"], job.get("steps", 9)
for it in job["items"]:
    for seed in it["seeds"]:
        t = time.time()
        g = torch.Generator("cuda").manual_seed(seed)
        img = pipe(
            prompt_embeds=[e.to("cuda") for e in embeds[it["name"]]],
            height=H, width=W, num_inference_steps=steps, guidance_scale=0.0, generator=g,
        ).images[0]
        p = os.path.join(job["out"], f"{it['name']}_s{seed}.png")
        img.save(p)
        print(f"{p}  {time.time() - t:.1f}s", flush=True)
