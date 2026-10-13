"""NEXUS art post-processing: alpha matte (BiRefNet, MIT) + contract crops + WEBP.

python post.py matte <in.png> <out_rgba.png>
python post.py export <rgba.png> <outdir> <avatar_box x,y,size> [portrait_box x,y,w]
    portrait_box defaults to the full frame (master is already 3:4).
"""
import io, os, sys
os.environ.setdefault("HF_HOME", r"D:\nexus-artgen\hf")
from PIL import Image


def matte(src, dst):
    import torch
    from torchvision import transforms
    from transformers import AutoModelForImageSegmentation
    m = AutoModelForImageSegmentation.from_pretrained("ZhengPeng7/BiRefNet", trust_remote_code=True)
    m.to("cuda").eval().half()
    img = Image.open(src).convert("RGB")
    tf = transforms.Compose([
        transforms.Resize((1024, 1024)), transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    with torch.no_grad():
        pred = m(tf(img).unsqueeze(0).to("cuda").half())[-1].sigmoid().float().cpu()[0].squeeze()
    mask = transforms.ToPILImage()(pred).resize(img.size, Image.LANCZOS)
    out = img.copy(); out.putalpha(mask)
    out.save(dst)
    print("matte", dst)


def webp(img, path, max_kb, q=90):
    while q >= 50:
        b = io.BytesIO(); img.save(b, "WEBP", quality=q, method=6, alpha_quality=90)
        if b.tell() <= max_kb * 1024:
            open(path, "wb").write(b.getvalue()); print(path, img.size, f"{b.tell()/1024:.1f}KB q{q}"); return
        q -= 4
    raise SystemExit(f"{path}: no cabe en {max_kb} KB")


def export(src, outdir, avatar_box, portrait_box=None):
    os.makedirs(outdir, exist_ok=True)
    im = Image.open(src).convert("RGBA")
    W, H = im.size
    if portrait_box:
        x, y, w = portrait_box; por = im.crop((x, y, x + w, y + w * 4 // 3))
    else:
        por = im
    webp(por.resize((480, 640), Image.LANCZOS), os.path.join(outdir, "portrait.webp"), 90)
    webp(por.resize((960, 1280), Image.LANCZOS), os.path.join(outdir, "portrait-large.webp"), 220)
    ax, ay, s = avatar_box
    webp(im.crop((ax, ay, ax + s, ay + s)).resize((256, 256), Image.LANCZOS), os.path.join(outdir, "avatar.webp"), 40)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "matte":
        matte(sys.argv[2], sys.argv[3])
    else:
        box = tuple(int(v) for v in sys.argv[4].split(","))
        pb = tuple(int(v) for v in sys.argv[5].split(",")) if len(sys.argv) > 5 else None
        export(sys.argv[2], sys.argv[3], box, pb)
