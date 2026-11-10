"""Refinement passes on a chosen base: img2img and inpaint (same Z-Image-Turbo Q8 model).

python refine.py <job.json>
job = {"out": dir, "steps": 9, "ops": [
   {"name", "mode": "img2img"|"inpaint", "image": path, "mask": path|None,
    "prompt": str, "strength": float, "seeds": [int]}]}
"""
import gc, json, os, sys, time
import torch
os.environ.setdefault("HF_HOME", r"D:\nexus-artgen\hf")
from PIL import Image
from diffusers import (ZImagePipeline, ZImageImg2ImgPipeline, ZImageInpaintPipeline,
                       ZImageTransformer2DModel, GGUFQuantizationConfig)

REPO = "Tongyi-MAI/Z-Image-Turbo"
GGUF = r"D:\nexus-artgen\models\z-image-turbo-Q8_0.gguf"
job = json.load(open(sys.argv[1], encoding="utf-8"))
os.makedirs(job["out"], exist_ok=True)
dt = torch.bfloat16

base = ZImagePipeline.from_pretrained(REPO, transformer=None, torch_dtype=dt)
base.text_encoder.to("cuda")
emb = {}
with torch.no_grad():
    for op in job["ops"]:
        pe, _ = base.encode_prompt(prompt=op["prompt"], device="cuda", do_classifier_free_guidance=False)
        emb[op["name"]] = [e.to("cpu") for e in pe]
base.text_encoder.to("cpu"); del base.text_encoder; base.text_encoder = None
gc.collect(); torch.cuda.empty_cache()

tr = ZImageTransformer2DModel.from_single_file(
    GGUF, quantization_config=GGUFQuantizationConfig(compute_dtype=dt),
    config=REPO, subfolder="transformer", torch_dtype=dt)
comp = dict(transformer=tr, vae=base.vae, text_encoder=None, tokenizer=base.tokenizer, scheduler=base.scheduler)
pipes = {"img2img": ZImageImg2ImgPipeline(**comp).to("cuda"), "inpaint": ZImageInpaintPipeline(**comp).to("cuda")}

for op in job["ops"]:
    img = Image.open(op["image"]).convert("RGB")
    kw = dict(image=img, strength=op["strength"], height=img.height, width=img.width,
              num_inference_steps=job.get("steps", 9), guidance_scale=0.0)
    if op["mode"] == "inpaint":
        kw["mask_image"] = Image.open(op["mask"]).convert("L")
    for seed in op["seeds"]:
        t = time.time()
        out = pipes[op["mode"]](prompt_embeds=[e.to("cuda") for e in emb[op["name"]]],
                                generator=torch.Generator("cuda").manual_seed(seed), **kw).images[0]
        p = os.path.join(job["out"], f"{op['name']}_s{seed}.png"); out.save(p)
        print(f"{p}  {time.time() - t:.1f}s", flush=True)
