"""
SaaSShorts: AI-powered UGC video generator for SaaS products.

Pipeline:
  1. Scrape & analyze SaaS website (OpenAI)
  2. Generate video scripts (hook -> problem -> solution -> CTA)
  3. Generate AI actor portrait (Flux via fal.ai)
  4. Generate voiceover (ElevenLabs)
  5. Generate talking head video (Kling Avatar via fal.ai)
  6. Generate b-roll clips (Flux still + Ken Burns)
  7. Composite final video with subtitles (FFmpeg)
"""

import argparse
import json
import os
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Dict, List, Optional
from urllib.parse import urljoin
import httpx
from openai import OpenAI


ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1"
FAL_QUEUE_BASE = "https://queue.fal.run"
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

DEFAULT_VOICES = {
    "Rachel (Female, calm)": "21m00Tcm4TlvDq8ikWAM",
    "Drew (Male, confident)": "29vD33N1CtxCmqQRPOHJ",
    "Bella (Female, soft)": "EXAVITQu4vr4xnSDxMaL",
    "Antoni (Male, warm)": "ErXwobaYiN019PkySvjV",
    "Josh (Male, deep)": "TxGEqnHWrfWFTfGW9XjX",
    "Sam (Male, raspy)": "yoZ06aMxZJJ28mfd3POQ",
}

LUXURY_COUPLE_VIDEO_BRIEF = {
    "character_traits": (
        "The featured couple acts as avatars for the prospective buyer. "
        "They are young, conventionally attractive, impeccably styled, physically fit, "
        "and playfully in love. They move through the space with absolute ownership and "
        "careless ease, untouched by stress."
    ),
    "emotional_arc": (
        "The story is a day in the life of bliss. It starts with high-energy arrival and "
        "daytime play like dancing in the foyer, rallying on the tennis court, and working out. "
        "It gradually downshifts into a relaxed, sensual evening with golden-hour poolside lounging "
        "and sunset views over the water. The journey is a straight line of continuous indulgence."
    ),
}


def _slug(value: str, limit: int = 30) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")[:limit] or "video"


def _clean_json_block(text: str, opener: str, closer: str) -> str:
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    start, end = text.find(opener), text.rfind(closer)
    return text[start : end + 1] if start != -1 and end != -1 else text


def _response_text(response) -> str:
    text = getattr(response, "output_text", "") or ""
    if text:
        return text
    parts = []
    for item in getattr(response, "output", []) or []:
        for content in getattr(item, "content", []) or []:
            piece = getattr(content, "text", None)
            if piece:
                parts.append(piece)
    return "\n".join(parts)


def _openai_client(api_key: str) -> OpenAI:
    return OpenAI(api_key=api_key)


def _openai_json(
    prompt: str,
    openai_key: str,
    *,
    as_array: bool = False,
    use_web_search: bool = False,
    max_output_tokens: int = 8192,
) -> dict | list:
    client = _openai_client(openai_key)
    kwargs = {
        "model": OPENAI_MODEL,
        "input": prompt,
        "max_output_tokens": max_output_tokens,
    }
    if use_web_search:
        kwargs["tools"] = [{"type": "web_search_preview"}]

    response = client.responses.create(**kwargs)
    raw = _response_text(response)
    if not raw:
        raise Exception("OpenAI returned empty response")

    body = _clean_json_block(raw, "[" if as_array else "{", "]" if as_array else "}")
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise Exception(f"Failed to parse OpenAI JSON: {exc}\nRaw: {body[:800]}")


def build_creative_brief(extra: Optional[dict] = None) -> str:
    brief = {**LUXURY_COUPLE_VIDEO_BRIEF, **(extra or {})}
    return (
        f"Character traits: {brief['character_traits']}\n"
        f"Emotional arc: {brief['emotional_arc']}"
    )


# ═══════════════════════════════════════════════════════════════════════
# Phase 1: Website Scraping, Research & Analysis
# ═══════════════════════════════════════════════════════════════════════

def research_saas_online(url: str, openai_key: str) -> dict:
    """Research a SaaS product using OpenAI + web search."""
    print(f"[SaaSShorts] 🔍 Researching {url} with OpenAI web search...")
    domain = url.replace("https://", "").replace("http://", "").split("/")[0]

    prompt = f"""You are a world-class SaaS market researcher.
Research this product using web search and return JSON only.

Product URL: {url}
Domain: {domain}

Investigate:
1. What the product does
2. Real user reviews and sentiment
3. Common complaints and praise
4. Competitors
5. Pricing
6. Target audience
7. Viral discussions and content angles

Return:
{{
  "product_name": "...",
  "website_url": "{url}",
  "what_it_does": "...",
  "target_market": "...",
  "pricing_info": "...",
  "user_sentiment": "positive/mixed/negative",
  "real_reviews": [{{"source": "...", "quote": "...", "sentiment": "positive/negative/neutral"}}],
  "common_complaints": ["..."],
  "common_praise": ["..."],
  "competitors": [{{"name": "...", "comparison": "..."}}],
  "viral_potential": ["..."],
  "key_differentiators": ["..."],
  "content_angles_from_web": ["..."],
  "sources_found": ["https://..."]
}}
Use real findings. No markdown."""

    research = _openai_json(prompt, openai_key, use_web_search=True)
    print(f"[SaaSShorts] ✅ Web research complete: {len(research.get('sources_found', []))} sources")
    return research


def scrape_website(url: str) -> dict:
    """Scrape a SaaS website to extract key content for analysis."""
    from bs4 import BeautifulSoup

    print(f"[SaaSShorts] 🌐 Scraping {url}...")
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "iframe"]):
        tag.decompose()

    def _meta(name: str = "", prop: str = "") -> str:
        tag = soup.find("meta", attrs={"name": name} if name else {"property": prop})
        return tag.get("content", "") if tag else ""

    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    headings = [
        text for h in soup.find_all(["h1", "h2", "h3"])
        if (text := h.get_text(strip=True)) and len(text) < 200
    ]

    text = re.sub(r"\n{3,}", "\n\n", soup.get_text(separator="\n", strip=True))[:10000]
    base_host = httpx.URL(url).host
    subpages = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].lower()
        if any(k in href for k in ["pricing", "features", "about", "product", "why", "how-it-works", "use-case"]):
            try:
                full_url = urljoin(url, a["href"])
                if httpx.URL(full_url).host == base_host:
                    subpages.add(full_url)
            except Exception:
                pass

    additional = ""
    for sub_url in list(subpages)[:3]:
        try:
            print(f"[SaaSShorts]   → Subpage: {sub_url}")
            with httpx.Client(timeout=20.0, follow_redirects=True) as client:
                resp = client.get(sub_url, headers=headers)
            if resp.status_code != 200:
                continue
            sub_soup = BeautifulSoup(resp.text, "html.parser")
            for tag in sub_soup(["script", "style", "nav", "footer", "header", "noscript"]):
                tag.decompose()
            additional += f"\n\n--- {sub_url} ---\n{sub_soup.get_text(separator='\n', strip=True)[:5000]}"
        except Exception as exc:
            print(f"[SaaSShorts]   ⚠️ Failed: {exc}")

    result = {
        "url": url,
        "title": title,
        "meta_description": _meta(name="description") or _meta(prop="og:description"),
        "headings": headings[:20],
        "main_content": text,
        "additional_pages": additional[:15000],
        "pages_scraped": 1 + min(len(subpages), 3),
    }
    print(f"[SaaSShorts] ✅ Scraped {result['pages_scraped']} pages, {len(text)} chars")
    return result


def analyze_saas(scraped_data: dict, openai_key: str, web_research: Optional[dict] = None) -> dict:
    """Analyze a SaaS product from website data + external research."""
    print(f"[SaaSShorts] 🧠 Analyzing {scraped_data['url']} with OpenAI...")
    research_context = json.dumps(web_research or {}, indent=2)[:12000]

    prompt = f"""You are an expert SaaS marketing analyst and UGC strategist.
Analyze this SaaS product for viral short-form video creation.

Website: {scraped_data['url']}
Title: {scraped_data['title']}
Meta: {scraped_data['meta_description']}
Headings: {json.dumps(scraped_data['headings'][:15])}

Website content:
{scraped_data['main_content'][:6000]}

Additional pages:
{scraped_data['additional_pages'][:8000]}

External research:
{research_context}

Return JSON only:
{{
  "product_name": "...",
  "one_liner": "...",
  "target_audience": ["..."],
  "pain_points": [
    {{"pain": "...", "intensity": "high/medium/low", "emotional_trigger": "frustration/fear/time-waste/money-loss/overwhelm", "source": "website/user-reviews/reddit/general"}}
  ],
  "key_features": ["..."],
  "unique_selling_points": ["..."],
  "competitors": [{{"name": "...", "comparison": "..."}}],
  "pricing_model": "freemium/subscription/one-time/usage-based",
  "pricing_details": "...",
  "industry": "...",
  "user_sentiment_summary": "...",
  "emotional_hooks": ["..."],
  "transformation_story": "...",
  "viral_angles": [
    {{"angle": "...", "platform": "tiktok/instagram/both", "style": "ugc/educational/shock/story", "why_viral": "..."}}
  ]
}}
Use real pain points when available. No markdown."""

    analysis = _openai_json(prompt, openai_key)
    if web_research and web_research.get("sources_found"):
        analysis["_web_sources"] = web_research["sources_found"]
    print(
        f"[SaaSShorts] ✅ Analysis: {analysis.get('product_name', '?')} "
        f"({len(analysis.get('pain_points', []))} pain points)"
    )
    return analysis


def generate_scripts(
    analysis: dict,
    openai_key: str,
    num_scripts: int = 3,
    style: str = "ugc",
    language: str = "en",
    actor_gender: str = "female",
    creative_brief: Optional[dict] = None,
) -> list:
    """Generate short-form scripts and luxury lifestyle b-roll prompts."""
    lang_name = "Spanish" if language == "es" else "English"
    print(f"[SaaSShorts] 📝 Generating {num_scripts} scripts ({style}, {lang_name})...")

    style_guide = {
        "ugc": "Natural and authentic. Conversational, punchy, creator-led.",
        "educational": "Clear explanations with practical authority.",
        "shock": "Surprising opener with immediate tension.",
        "story": "Mini narrative with clean emotional progression.",
        "comparison": "Before/after contrast with concrete stakes.",
    }
    language_rules = (
        "All narration, subtitles, captions, and hashtags must be in SPANISH."
        if language == "es"
        else "All narration, subtitles, captions, and hashtags must be in ENGLISH."
    )
    brief_text = build_creative_brief(creative_brief)

    prompt = f"""You are a viral TikTok / Reels scriptwriter.
Generate exactly {num_scripts} scripts as a JSON array only.

{language_rules}
Style: {style_guide.get(style, style_guide["ugc"])}
Actor gender: {actor_gender}

Product analysis:
{json.dumps(analysis, indent=2)}

Luxury lifestyle video brief for all visual storytelling:
{brief_text}

Every script must be 20-25 seconds and use exactly 5 segments:
1. hook: actor_talking
2. problem: broll
3. solution: actor_talking
4. demo: broll
5. cta: actor_talking

Rules:
- Exactly 5 segments
- Segments 2 and 4 must have visual="broll" and non-null broll_prompt
- Segments 1, 3, 5 must have visual="actor_talking" and broll_prompt=null
- Total duration 20-25 seconds
- full_narration = all narration joined
- actor_description must be in ENGLISH only
- actor_description should describe one polished, attractive, natural-looking European creator aged 22-35
- broll_prompt must reflect the luxury couple brief:
  - The couple are aspirational buyer avatars
  - They are playful, stylish, fit, and stress-free
  - Visual arc should move from arrival/daytime energy to relaxed golden-hour indulgence
  - Use specific actions like foyer dancing, sport, working out, pool lounging, sunset watching when relevant

Return this JSON array shape:
[
  {{
    "title": "Short internal title",
    "style": "{style}",
    "duration_seconds": 23,
    "target_platform": "tiktok",
    "hook_text": "2-5 words",
    "segments": [
      {{"type":"hook","start":0,"end":5,"narration":"...","visual":"actor_talking","broll_prompt":null,"emotion":"excited","subtitle_text":"..."}},
      {{"type":"problem","start":5,"end":9,"narration":"...","visual":"broll","broll_prompt":"...","emotion":"frustrated","subtitle_text":"..."}},
      {{"type":"solution","start":9,"end":16,"narration":"...","visual":"actor_talking","broll_prompt":null,"emotion":"confident","subtitle_text":"..."}},
      {{"type":"demo","start":16,"end":21,"narration":"...","visual":"broll","broll_prompt":"...","emotion":"excited","subtitle_text":"..."}},
      {{"type":"cta","start":21,"end":23,"narration":"...","visual":"actor_talking","broll_prompt":null,"emotion":"confident","subtitle_text":"Link in bio"}}
    ],
    "full_narration": "...",
    "actor_description": "a 26 year old attractive european woman, light brown wavy hair, wearing a white tank top, natural minimal makeup, friendly face",
    "hashtags": ["#saas", "#productivity", "#techtools"],
    "caption": "..."
  }}
]
No markdown."""

    scripts = _openai_json(prompt, openai_key, as_array=True)
    print(f"[SaaSShorts] ✅ Generated {len(scripts)} scripts")
    return scripts


# ═══════════════════════════════════════════════════════════════════════
# Phase 2: Asset Generation
# ═══════════════════════════════════════════════════════════════════════

def _fal_run(model_id: str, input_data: dict, fal_key: str, timeout: int = 600) -> dict:
    """Submit a job to fal.ai, poll, and return the result."""
    headers = {"Authorization": f"Key {fal_key}", "Content-Type": "application/json"}
    submit_url = f"{FAL_QUEUE_BASE}/{model_id}"
    print(f"[fal.ai] Submitting to {submit_url}...")

    with httpx.Client(timeout=120.0) as client:
        resp = client.post(submit_url, headers=headers, json=input_data)
    if resp.status_code >= 400:
        raise Exception(f"fal.ai error ({resp.status_code}): {resp.text[:300]}")

    submit_data = resp.json()
    request_id = submit_data.get("request_id")
    if not request_id:
        return submit_data

    status_url = submit_data.get("status_url", f"{submit_url}/requests/{request_id}/status")
    response_url = submit_data.get("response_url", f"{submit_url}/requests/{request_id}")
    poll_headers = {"Authorization": f"Key {fal_key}"}
    start = time.time()

    while time.time() - start < timeout:
        try:
            with httpx.Client(timeout=30.0) as client:
                status_data = client.get(f"{status_url}?logs=1", headers=poll_headers).json()
        except Exception as exc:
            print(f"[fal.ai] Poll error (retrying): {exc}")
            time.sleep(5)
            continue

        status = status_data.get("status", "UNKNOWN")
        if status == "COMPLETED":
            with httpx.Client(timeout=120.0) as client:
                return client.get(response_url, headers=poll_headers).json()
        if status in ("FAILED", "CANCELLED"):
            raise Exception(f"fal.ai job {status}: {status_data.get('error', 'unknown error')}")

        print(f"[fal.ai] {model_id}: {status} ({int(time.time() - start)}s)")
        time.sleep(5)

    raise Exception(f"fal.ai job timed out after {timeout}s for {model_id}")


def _fal_upload_file(file_path: str, fal_key: str) -> str:
    """Upload a local file to fal.ai CDN and return its public URL."""
    headers = {"Authorization": f"Key {fal_key}"}
    filename = os.path.basename(file_path)
    ext = os.path.splitext(filename)[1].lower()
    content_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".mp4": "video/mp4",
        ".webp": "image/webp",
    }
    content_type = content_types.get(ext, "application/octet-stream")

    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            "https://rest.alpha.fal.ai/storage/upload/initiate",
            headers={**headers, "Content-Type": "application/json"},
            json={"file_name": filename, "content_type": content_type},
        )
        resp.raise_for_status()
        upload_info = resp.json()

    with open(file_path, "rb") as fh:
        file_bytes = fh.read()
    with httpx.Client(timeout=120.0) as client:
        put = client.put(upload_info["upload_url"], content=file_bytes, headers={"Content-Type": content_type})
        put.raise_for_status()

    print(f"[fal.ai] Uploaded {filename} → {upload_info['file_url']}")
    return upload_info["file_url"]


def generate_actor_images(
    description: str,
    fal_key: str,
    output_dir: str,
    title_slug: str,
    num_options: int = 3,
    product_description: Optional[str] = None,
) -> List[str]:
    """Generate multiple photorealistic actor portrait options."""
    print(f"[SaaSShorts] 🎨 Generating {num_options} actor image options...")
    import random

    clean_desc = description
    for token in ["hablando", "talking", "sentad", "sitting", "desde", "from", "detrás", "behind"]:
        idx = clean_desc.lower().find(token)
        if idx > 10:
            clean_desc = clean_desc[:idx].rstrip(" ,.")

    img_num = random.randint(1000, 9999)
    if product_description:
        prompt = (
            f"IMG_{img_num}.jpg Raw candid selfie of {clean_desc}, casually holding {product_description}, "
            "showing it to the camera with a natural smile. Product clearly visible in hand. "
            "Casual and real, not an ad. Low quality front camera, soft room lighting. Reddit selfie."
        )
    else:
        prompt = (
            f"IMG_{img_num}.jpg Raw candid selfie of {clean_desc}, sitting at their desk at home, "
            "looking at camera with a relaxed natural smile. Headphones around neck, monitor glow behind them. "
            "Not posed, casual and real. Low quality front camera, soft room lighting. Reddit selfie."
        )

    def _gen_one(i: int) -> str:
        result = _fal_run(
            "fal-ai/flux-2-pro",
            {
                "prompt": prompt,
                "image_size": "portrait_4_3",
                "safety_tolerance": 5,
                "seed": random.randint(0, 999999),
            },
            fal_key,
            timeout=300,
        )
        images = result.get("images") or result.get("output", [])
        if not images:
            raise Exception(f"No images in actor result: {list(result.keys())}")
        img_url = images[0]["url"] if isinstance(images[0], dict) else images[0]
        img_path = os.path.join(output_dir, f"{title_slug}_actor_option_{i}.png")
        with httpx.Client(timeout=60.0) as client:
            img_resp = client.get(img_url)
        with open(img_path, "wb") as fh:
            fh.write(img_resp.content)
        print(f"[SaaSShorts] ✅ Actor option {i + 1}: {img_path}")
        return img_path

    with ThreadPoolExecutor(max_workers=num_options) as executor:
        futures = [executor.submit(_gen_one, i) for i in range(num_options)]
        return sorted(f.result() for f in as_completed(futures))


def generate_actor_image(description: str, fal_key: str, output_path: str) -> str:
    """Generate one actor portrait."""
    output_dir = os.path.dirname(output_path)
    paths = generate_actor_images(description, fal_key, output_dir, _slug(os.path.basename(output_path)), num_options=1)
    if paths:
        import shutil
        shutil.move(paths[0], output_path)
    return output_path


def generate_voiceover(
    text: str,
    elevenlabs_key: str,
    output_path: str,
    voice_id: str = "21m00Tcm4TlvDq8ikWAM",
) -> str:
    """Generate voiceover audio with ElevenLabs."""
    print(f"[SaaSShorts] 🎙️ Generating voiceover ({len(text)} chars)...")
    url = f"{ELEVENLABS_API_BASE}/text-to-speech/{voice_id}"
    body = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "style": 0.4,
            "use_speaker_boost": True,
        },
    }
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(url, headers={"xi-api-key": elevenlabs_key, "Content-Type": "application/json"}, json=body)
    if resp.status_code != 200:
        if resp.status_code in (401, 403) and os.getenv("OPENAI_API_KEY"):
            print(f"[SaaSShorts] ElevenLabs rejected TTS ({resp.status_code}); using OpenAI TTS fallback.")
            client = _openai_client(os.environ["OPENAI_API_KEY"])
            with client.audio.speech.with_streaming_response.create(
                model=os.getenv("OPENAI_TTS_MODEL", "tts-1"),
                voice=os.getenv("OPENAI_TTS_VOICE", "alloy"),
                input=text,
            ) as speech:
                speech.stream_to_file(output_path)
            print(f"[SaaSShorts] ✅ Voiceover fallback: {output_path}")
            return output_path
        raise Exception(f"ElevenLabs TTS error ({resp.status_code}): {resp.text}")
    with open(output_path, "wb") as fh:
        fh.write(resp.content)
    print(f"[SaaSShorts] ✅ Voiceover: {output_path}")
    return output_path


def get_elevenlabs_voices(elevenlabs_key: str) -> list:
    """Fetch available ElevenLabs voices."""
    with httpx.Client(timeout=15.0) as client:
        resp = client.get(f"{ELEVENLABS_API_BASE}/voices", headers={"xi-api-key": elevenlabs_key})
    if resp.status_code != 200:
        return []
    data = resp.json()
    return [
        {
            "voice_id": voice["voice_id"],
            "name": voice["name"],
            "category": voice.get("category", ""),
            "labels": voice.get("labels", {}),
            "preview_url": voice.get("preview_url", ""),
        }
        for voice in data.get("voices", [])
    ]


# ═══════════════════════════════════════════════════════════════════════
# Phase 3: Video Generation
# ═══════════════════════════════════════════════════════════════════════

def generate_talking_head(image_path: str, audio_path: str, fal_key: str, output_path: str) -> str:
    """Generate talking head video with Kling Avatar."""
    print("[SaaSShorts] 🗣️ Generating talking head...")
    image_url = _fal_upload_file(image_path, fal_key)
    audio_url = _fal_upload_file(audio_path, fal_key)
    result = _fal_run(
        "fal-ai/kling-video/ai-avatar/v2/standard",
        {
            "image_url": image_url,
            "audio_url": audio_url,
            "prompt": (
                "Natural UGC creator talking to camera. Expressive and energetic. "
                "Subtle hand gestures, slight head movement, relaxed shoulders, steady eye contact."
            ),
        },
        fal_key,
        timeout=600,
    )
    video_url = result["video"]["url"]
    with httpx.Client(timeout=180.0) as client:
        vid_resp = client.get(video_url)
    with open(output_path, "wb") as fh:
        fh.write(vid_resp.content)
    print(f"[SaaSShorts] ✅ Talking head: {output_path}")
    return output_path


def generate_talking_head_lowcost(image_path: str, audio_path: str, fal_key: str, output_path: str) -> str:
    """Low-cost talking head: Hailuo image-to-video -> VEED lipsync."""
    print("[SaaSShorts] 🗣️ Generating talking head (low cost)...")
    hailuo_cache = output_path.replace(".mp4", "_hailuo_cache.mp4")
    if os.path.exists(hailuo_cache) and os.path.getsize(hailuo_cache) > 0:
        hailuo_video_url = _fal_upload_file(hailuo_cache, fal_key)
    else:
        image_url = _fal_upload_file(image_path, fal_key)
        result = _fal_run(
            "fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video",
            {
                "image_url": image_url,
                "prompt": (
                    "Person talking to camera, subtle head nods and natural micro-expressions. "
                    "Gentle head movement, slight shoulder sway, eye contact, natural blinking."
                ),
            },
            fal_key,
            timeout=300,
        )
        hailuo_video_url = (
            result.get("video", {}).get("url")
            if isinstance(result.get("video"), dict)
            else result.get("video") or result.get("video_url")
        )
        if not hailuo_video_url:
            raise Exception(f"No video in Hailuo result: {result}")
        with httpx.Client(timeout=180.0) as client:
            vid_resp = client.get(hailuo_video_url)
        with open(hailuo_cache, "wb") as fh:
            fh.write(vid_resp.content)

    audio_url = _fal_upload_file(audio_path, fal_key)
    lipsync = _fal_run("veed/lipsync", {"video_url": hailuo_video_url, "audio_url": audio_url}, fal_key, timeout=900)
    video_url = lipsync.get("video", {}).get("url") if isinstance(lipsync.get("video"), dict) else lipsync.get("video")
    if not video_url:
        raise Exception(f"No video in VEED Lipsync result: {lipsync}")
    with httpx.Client(timeout=180.0) as client:
        vid_resp = client.get(video_url)
    with open(output_path, "wb") as fh:
        fh.write(vid_resp.content)
    print(f"[SaaSShorts] ✅ Talking head (low cost): {output_path}")
    return output_path


def _augment_broll_prompt(prompt: str, creative_brief: Optional[dict] = None) -> str:
    brief = build_creative_brief(creative_brief)
    return (
        f"{prompt}. "
        "Photorealistic luxury real-estate lifestyle frame. "
        "Feature the aspirational couple as buyer avatars. "
        f"{brief} "
        "Cinematic composition, premium materials, controlled lighting, stable architecture."
    )


def generate_broll(
    prompt: str,
    fal_key: str,
    output_path: str,
    duration: str = "5",
    creative_brief: Optional[dict] = None,
) -> str:
    """Generate b-roll as a Flux still plus subtle Ken Burns motion."""
    print("[SaaSShorts] 🎬 Generating b-roll image + Ken Burns...")
    dur_secs = int(duration)
    img_path = output_path.replace(".mp4", "_img.png")
    result = _fal_run(
        "fal-ai/flux-2-pro",
        {
            "prompt": _augment_broll_prompt(prompt, creative_brief),
            "image_size": "portrait_4_3",
            "safety_tolerance": 5,
        },
        fal_key,
        timeout=300,
    )
    images = result.get("images") or result.get("output", [])
    if not images:
        raise Exception(f"No images in b-roll result: {list(result.keys())}")
    img_url = images[0]["url"] if isinstance(images[0], dict) else images[0]
    with httpx.Client(timeout=60.0) as client:
        img_resp = client.get(img_url)
    with open(img_path, "wb") as fh:
        fh.write(img_resp.content)

    fps = 30
    total_frames = dur_secs * fps
    zoompan = (
        f"scale=2160:3840,"
        f"zoompan=z='1+0.15*on/{total_frames}':"
        f"x='iw/2-(iw/zoom/2)+10*on/{total_frames}':"
        f"y='ih/2-(ih/zoom/2)':d={total_frames}:s=1080x1920:fps={fps},setsar=1"
    )
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-i", img_path,
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-vf", zoompan,
        "-t", str(dur_secs),
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
        "-shortest", output_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    if os.path.exists(img_path):
        os.remove(img_path)
    print(f"[SaaSShorts] ✅ B-roll: {output_path}")
    return output_path


# ═══════════════════════════════════════════════════════════════════════
# Phase 4: Compositing
# ═══════════════════════════════════════════════════════════════════════

def _get_media_duration(path: str) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        return float(result.stdout.strip() or 30.0)
    except Exception:
        return 30.0


def _format_ass_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int((seconds - int(seconds)) * 100)
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _ffmpeg_has_filter(name: str) -> bool:
    try:
        result = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True)
        return f" {name} " in result.stdout
    except Exception:
        return False


def transcribe_audio_for_subs(audio_path: str) -> list:
    from faster_whisper import WhisperModel

    print("[SaaSShorts] 🎙️ Transcribing audio...")
    model = WhisperModel("base", device="cpu", compute_type="int8")
    segments, _ = model.transcribe(audio_path, word_timestamps=True)
    words = []
    for segment in segments:
        for word in segment.words or []:
            words.append({"word": word.word.strip(), "start": word.start, "end": word.end})
    print(f"[SaaSShorts] ✅ Transcribed {len(words)} words")
    return words


def generate_tiktok_subs(audio_path: str, output_path: str, max_words: int = 3) -> str:
    words = transcribe_audio_for_subs(audio_path)
    if not words:
        with open(output_path, "w") as fh:
            fh.write("")
        return output_path

    chunks = []
    for i in range(0, len(words), max_words):
        group = words[i : i + max_words]
        chunks.append({
            "text": " ".join(w["word"] for w in group).upper(),
            "start": group[0]["start"],
            "end": group[-1]["end"],
        })

    ass = """[Script Info]
Title: TikTok Style Subs
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: TikTok,Arial Black,90,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,4,0,2,40,40,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    for chunk in chunks:
        ass += (
            f"Dialogue: 0,{_format_ass_time(chunk['start'])},{_format_ass_time(chunk['end'])},"
            f"TikTok,,0,0,0,,{chunk['text']}\n"
        )
    with open(output_path, "w", encoding="utf-8") as fh:
        fh.write(ass)
    return output_path


def composite_video(
    talking_head_path: str,
    broll_clips: List[Dict],
    srt_path: str,
    hook_text: str,
    output_path: str,
) -> str:
    """Composite talking head, b-roll inserts, and subtitles."""
    print("[SaaSShorts] 🎞️ Compositing final video...")
    safe_sub = os.path.abspath(srt_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    if _ffmpeg_has_filter("ass"):
        sub_filter = f"ass=filename='{safe_sub}'"
    elif _ffmpeg_has_filter("subtitles"):
        sub_filter = f"subtitles=filename='{safe_sub}'"
    else:
        sub_filter = None
        print("[SaaSShorts] ⚠️ FFmpeg has no ass/subtitles filter; compositing without burned subtitles.")

    if not broll_clips:
        cmd = ["ffmpeg", "-y", "-i", talking_head_path]
        if sub_filter:
            cmd.extend(["-vf", sub_filter])
        cmd.extend([
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-c:a", "aac", "-b:a", "128k",
            output_path,
        ])
        subprocess.run(cmd, check=True)
        return output_path

    th_duration = _get_media_duration(talking_head_path)
    sorted_broll = sorted(broll_clips, key=lambda x: x["start"])
    inputs = ["-i", talking_head_path]
    for clip in sorted_broll:
        inputs.extend(["-i", clip["path"]])

    segments, prev_end = [], 0.0
    durations = {i: _get_media_duration(clip["path"]) for i, clip in enumerate(sorted_broll)}
    for i, clip in enumerate(sorted_broll):
        bstart = clip["start"]
        bend = min(clip["end"], bstart + durations[i])
        if prev_end < bstart:
            segments.append({"type": "th", "start": prev_end, "end": bstart})
        segments.append({"type": "broll", "index": i, "start": bstart, "end": bend, "duration": bend - bstart})
        prev_end = bend
    if prev_end < th_duration:
        segments.append({"type": "th", "start": prev_end, "end": th_duration})

    norm = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,fps=30,setsar=1"
    parts, concat = [], []
    for idx, seg in enumerate(segments):
        if seg["type"] == "th":
            parts.append(f"[0:v]trim=start={seg['start']:.3f}:end={seg['end']:.3f},setpts=PTS-STARTPTS,{norm}[tv{idx}]")
            parts.append(f"[0:a]atrim=start={seg['start']:.3f}:end={seg['end']:.3f},asetpts=PTS-STARTPTS[ta{idx}]")
            concat.append(f"[tv{idx}][ta{idx}]")
        else:
            src = seg["index"] + 1
            dur = seg["duration"]
            parts.append(f"[{src}:v]trim=start=0:end={dur:.3f},setpts=PTS-STARTPTS,{norm}[bv{idx}]")
            parts.append(f"[0:a]atrim=start={seg['start']:.3f}:end={seg['end']:.3f},asetpts=PTS-STARTPTS[ba{idx}]")
            concat.append(f"[bv{idx}][ba{idx}]")
    parts.append(f"{''.join(concat)}concat=n={len(segments)}:v=1:a=1[outv][outa]")
    if sub_filter:
        parts.append(f"[outv]{sub_filter}[finalv]")
        video_map = "[finalv]"
    else:
        video_map = "[outv]"

    subprocess.run(
        [
            "ffmpeg", "-y", *inputs,
            "-filter_complex", ";".join(parts),
            "-map", video_map, "-map", "[outa]",
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-c:a", "aac", "-b:a", "128k",
            output_path,
        ],
        check=True,
    )
    return output_path


# ═══════════════════════════════════════════════════════════════════════
# Orchestrator
# ═══════════════════════════════════════════════════════════════════════

def generate_full_video(
    script: dict,
    config: dict,
    output_dir: str,
    log: Callable[[str], None] = print,
) -> dict:
    """Full SaaSShorts generation pipeline."""
    os.makedirs(output_dir, exist_ok=True)
    fal_key = config["fal_key"]
    elevenlabs_key = config["elevenlabs_key"]
    voice_id = config.get("voice_id", DEFAULT_VOICES["Rachel (Female, calm)"])
    creative_brief = config.get("creative_brief", LUXURY_COUPLE_VIDEO_BRIEF)
    actor_desc = config.get("actor_description") or script.get(
        "actor_description",
        "a polished attractive european creator in their late 20s, wearing a clean casual modern outfit",
    )
    title_slug = _slug(script.get("title", "video"))

    actor_img = os.path.join(output_dir, f"{title_slug}_actor.png")
    audio_path = os.path.join(output_dir, f"{title_slug}_voice.mp3")
    talking_head = os.path.join(output_dir, f"{title_slug}_head.mp4")
    srt_path = os.path.join(output_dir, f"{title_slug}_subs.ass")
    final_path = os.path.join(output_dir, f"{title_slug}_final.mp4")
    full_narration = script.get("full_narration") or " ".join(seg.get("narration", "") for seg in script.get("segments", []))

    def _exists(path: str) -> bool:
        return os.path.exists(path) and os.path.getsize(path) > 0

    selected_actor = config.get("selected_actor_path")
    if selected_actor and os.path.exists(selected_actor) and not _exists(actor_img):
        import shutil
        shutil.copy2(selected_actor, actor_img)
        log("[1/6] Using pre-selected actor image.")

    need_img, need_voice = not _exists(actor_img), not _exists(audio_path)
    if need_img or need_voice:
        log(f"[1/6] Generating {' + '.join(x for x, on in [('actor image', need_img), ('voiceover', need_voice)] if on)}...")
        with ThreadPoolExecutor(max_workers=2) as executor:
            f_img = executor.submit(generate_actor_image, actor_desc, fal_key, actor_img) if need_img else None
            f_voice = executor.submit(generate_voiceover, full_narration, elevenlabs_key, audio_path, voice_id) if need_voice else None
            if f_img:
                actor_img = f_img.result()
            if f_voice:
                audio_path = f_voice.result()
        log("[2/6] Actor image and voiceover ready.")
    else:
        log("[1/6] Actor image and voiceover cached.")
        log("[2/6] ✅ Using cached assets.")

    if not _exists(talking_head):
        if config.get("video_mode", "premium") == "lowcost":
            log("[3/6] Generating talking head (low cost)...")
            talking_head = generate_talking_head_lowcost(actor_img, audio_path, fal_key, talking_head)
        else:
            log("[3/6] Generating talking head...")
            talking_head = generate_talking_head(actor_img, audio_path, fal_key, talking_head)
        log("[3/6] Talking head ready.")
    else:
        log("[3/6] ✅ Talking head cached.")

    broll_segments = [seg for seg in script.get("segments", []) if seg.get("visual") == "broll" and seg.get("broll_prompt")]
    broll_clips: List[Dict] = []
    if broll_segments:
        missing = []
        for i, seg in enumerate(broll_segments):
            path = os.path.join(output_dir, f"{title_slug}_broll_{i}.mp4")
            if _exists(path):
                broll_clips.append({"path": path, "start": seg["start"], "end": seg["end"]})
            else:
                missing.append((i, seg, path))

        if missing:
            log(f"[4/6] Generating {len(missing)} b-roll clips...")
            with ThreadPoolExecutor(max_workers=3) as executor:
                futures = {
                    executor.submit(generate_broll, seg["broll_prompt"], fal_key, path, "5", creative_brief): (seg, path)
                    for _, seg, path in missing
                }
                for future in as_completed(futures):
                    seg, path = futures[future]
                    try:
                        future.result()
                        broll_clips.append({"path": path, "start": seg["start"], "end": seg["end"]})
                        log(f"  ✅ {os.path.basename(path)}")
                    except Exception as exc:
                        log(f"  ⚠️ B-roll failed: {exc}")
        else:
            log("[4/6] ✅ All b-roll cached.")
    else:
        log("[4/6] No b-roll segments in script.")

    log("[5/6] Generating subtitles...")
    generate_tiktok_subs(audio_path, srt_path, max_words=2)

    log("[6/6] Compositing final video...")
    composite_video(talking_head, broll_clips, srt_path, script.get("hook_text", ""), final_path)
    log("🎉 Video generation complete!")

    audio_duration = _get_media_duration(audio_path)
    if config.get("video_mode", "premium") == "lowcost":
        cost = {
            "actor_image_flux": 0.05,
            "voiceover_elevenlabs": round(len(full_narration) * 0.00003, 3),
            "hailuo_img2video": 0.19,
            "veed_lipsync": 0.20,
            "broll_flux": round(len(broll_clips) * 0.05, 2),
            "ffmpeg_compositing": 0.00,
        }
    else:
        cost = {
            "actor_image_flux": 0.05,
            "voiceover_elevenlabs": round(len(full_narration) * 0.00003, 3),
            "talking_head_kling": round(audio_duration * 0.056, 2),
            "broll_flux": round(len(broll_clips) * 0.05, 2),
            "ffmpeg_compositing": 0.00,
        }
    cost["total"] = round(sum(cost.values()), 2)

    return {
        "video_path": final_path,
        "video_filename": os.path.basename(final_path),
        "srt_path": srt_path,
        "actor_image": actor_img,
        "duration": audio_duration,
        "cost_estimate": cost,
        "creative_brief": creative_brief,
    }


def _env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise SystemExit(f"Missing env var: {name}")
    return value


def build_plot_script(plot: str, brand: str, style: str = "story") -> dict:
    """Build a deterministic 5-part lifestyle script from the supplied plot."""
    return {
        "title": f"{brand} Bliss",
        "style": style,
        "duration_seconds": 23,
        "target_platform": "instagram",
        "hook_text": "Live the day",
        "segments": [
            {
                "type": "hook",
                "start": 0,
                "end": 5,
                "narration": "This is not just a home tour. This is the day you picture yourself living.",
                "visual": "actor_talking",
                "broll_prompt": None,
                "emotion": "excited",
                "subtitle_text": "This is the day",
            },
            {
                "type": "problem",
                "start": 5,
                "end": 9,
                "narration": "Morning starts with arrival energy, dancing through the foyer like the place is already yours.",
                "visual": "broll",
                "broll_prompt": (
                    "A young stylish fit couple arrives at a luxury waterfront estate and dances through "
                    "a grand foyer with playful confidence, polished fashion, cinematic daylight, ownership energy"
                ),
                "emotion": "playful",
                "subtitle_text": "Arrival energy",
            },
            {
                "type": "solution",
                "start": 9,
                "end": 16,
                "narration": "Then the whole property becomes your playground: tennis, training, sunlight, and zero stress.",
                "visual": "actor_talking",
                "broll_prompt": None,
                "emotion": "confident",
                "subtitle_text": "Your private playground",
            },
            {
                "type": "demo",
                "start": 16,
                "end": 21,
                "narration": "By golden hour, everything slows down by the pool as the water catches the sunset.",
                "visual": "broll",
                "broll_prompt": (
                    "The same young attractive couple lounges by a luxury pool at golden hour, relaxed and sensual, "
                    "waterfront sunset in the distance, long shadows, champagne light, effortless intimacy"
                ),
                "emotion": "relaxed",
                "subtitle_text": "Golden hour calm",
            },
            {
                "type": "cta",
                "start": 21,
                "end": 23,
                "narration": "Atlantic Palazzo Living. Link in bio.",
                "visual": "actor_talking",
                "broll_prompt": None,
                "emotion": "confident",
                "subtitle_text": "Link in bio",
            },
        ],
        "full_narration": (
            "This is not just a home tour. This is the day you picture yourself living. "
            "Morning starts with arrival energy, dancing through the foyer like the place is already yours. "
            "Then the whole property becomes your playground: tennis, training, sunlight, and zero stress. "
            "By golden hour, everything slows down by the pool as the water catches the sunset. "
            "Atlantic Palazzo Living. Link in bio."
        ),
        "actor_description": (
            "a 27 year old attractive european woman, glossy brunette hair, wearing a white linen camisole, "
            "natural polished makeup, fit elegant look, warm confident face"
        ),
        "hashtags": ["#luxuryliving", "#waterfrontliving", "#dreamhome"],
        "caption": "A day in the life of effortless waterfront living.",
        "plot": plot,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run SaaSShorts end-to-end.")
    parser.add_argument("--url", help="SaaS website URL")
    parser.add_argument("--plot", help="Skip scraping and use this plot/creative brief directly")
    parser.add_argument("--brand", default="Atlantic Palazzo Living", help="Brand or property name")
    parser.add_argument("--output-dir", default="output/saas_shorts", help="Output directory")
    parser.add_argument("--num-scripts", type=int, default=1, help="How many scripts to generate")
    parser.add_argument("--script-index", type=int, default=0, help="Which generated script to render")
    parser.add_argument("--style", default="ugc", help="Script style")
    parser.add_argument("--language", default="en", choices=["en", "es"], help="Script language")
    parser.add_argument("--actor-gender", default="female", choices=["female", "male"], help="Actor gender")
    parser.add_argument("--video-mode", default="premium", choices=["premium", "lowcost"], help="Video generation mode")
    parser.add_argument("--fixed-plot-script", action="store_true", help="Use a deterministic script from --plot")
    args = parser.parse_args()

    openai_key = _env("OPENAI_API_KEY")
    fal_key = _env("FAL_KEY")
    elevenlabs_key = _env("ELEVENLABS_API_KEY")

    if args.plot:
        analysis = {
            "product_name": args.brand,
            "one_liner": "A luxury property lifestyle fantasy built around effortless ownership, romance, and indulgence.",
            "target_audience": ["prospective luxury buyers", "high-income renters", "aspirational lifestyle seekers"],
            "pain_points": [
                {
                    "pain": "Most luxury property ads show rooms, not the life buyers imagine having there.",
                    "intensity": "high",
                    "emotional_trigger": "aspiration",
                    "source": "creative-brief",
                }
            ],
            "key_features": ["grand arrival", "foyer", "tennis court", "fitness spaces", "pool", "waterfront sunset"],
            "unique_selling_points": ["day-in-the-life luxury arc", "playful buyer-avatar couple", "waterfront resort-like lifestyle"],
            "competitors": [],
            "pricing_model": "real-estate",
            "pricing_details": "N/A",
            "industry": "luxury real estate",
            "user_sentiment_summary": "The desired feeling is continuous indulgence: arrival, play, wellness, golden hour, sunset.",
            "emotional_hooks": [
                "This is what ownership feels like",
                "A full day of resort living",
                "From morning energy to sunset calm",
                "The home sells the life",
            ],
            "transformation_story": args.plot,
            "viral_angles": [
                {
                    "angle": "Day in the life of a carefree couple moving through a luxury waterfront property",
                    "platform": "instagram",
                    "style": "cinematic lifestyle",
                    "why_viral": "It sells a fantasy viewers can immediately project themselves into.",
                }
            ],
        }
        research = {}
    else:
        if not args.url:
            raise SystemExit("Provide --url or --plot")
        scraped = scrape_website(args.url)
        research = research_saas_online(args.url, openai_key)
        analysis = analyze_saas(scraped, openai_key, research)
    if args.fixed_plot_script:
        if not args.plot:
            raise SystemExit("--fixed-plot-script requires --plot")
        scripts = [build_plot_script(args.plot, args.brand, args.style)]
    else:
        scripts = generate_scripts(
            analysis,
            openai_key,
            num_scripts=args.num_scripts,
            style=args.style,
            language=args.language,
            actor_gender=args.actor_gender,
            creative_brief={
                "character_traits": LUXURY_COUPLE_VIDEO_BRIEF["character_traits"],
                "emotional_arc": args.plot or LUXURY_COUPLE_VIDEO_BRIEF["emotional_arc"],
            },
        )
    if not scripts:
        raise SystemExit("No scripts generated")
    if args.script_index < 0 or args.script_index >= len(scripts):
        raise SystemExit(f"script-index out of range: {args.script_index}")

    result = generate_full_video(
        scripts[args.script_index],
        {
            "fal_key": fal_key,
            "elevenlabs_key": elevenlabs_key,
            "voice_id": os.getenv("ELEVENLABS_VOICE_ID", DEFAULT_VOICES["Rachel (Female, calm)"]),
            "video_mode": args.video_mode,
            "creative_brief": {
                "character_traits": LUXURY_COUPLE_VIDEO_BRIEF["character_traits"],
                "emotional_arc": args.plot or LUXURY_COUPLE_VIDEO_BRIEF["emotional_arc"],
            },
        },
        args.output_dir,
    )
    print(json.dumps({"analysis": analysis, "scripts": scripts, "result": result}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
