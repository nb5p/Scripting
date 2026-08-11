"""Advanced download runner: playlist support, format selection, subtitles, thumbnails.

Expects shared.py to be prepended. Sets globals: MARKER, progress_path,
cookie_file_path, cancel_token_path, then processes the URL with options.
"""
import mimetypes
import re
import urllib.parse
import urllib.request

current_progress = {
    "status": "preparing",
    "stage": "metadata",
    "itemIndex": 0,
    "itemCount": 0,
    "title": "",
    "downloadedBytes": 0,
    "totalBytes": None,
    "percent": None,
    "speed": None,
    "eta": None,
}


def atomic_progress(update):
    current_progress.update(update)
    atomic_write_json(progress_path, current_progress)


def progress_hook(data):
    check_cancelled()
    downloaded = number(data.get("downloaded_bytes")) or 0
    total = number(data.get("total_bytes")) or number(data.get("total_bytes_estimate"))
    percent = min(100, downloaded * 100 / total) if total and total > 0 else None
    atomic_progress({
        "status": "finished" if data.get("status") == "finished" else "downloading",
        "downloadedBytes": downloaded,
        "totalBytes": total,
        "percent": percent,
        "speed": number(data.get("speed")),
        "eta": number(data.get("eta")),
        "filename": data.get("filename") if isinstance(data.get("filename"), str) else None,
    })


def safe_component(value, fallback="item"):
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "_", str(value or ""))
    value = re.sub(r"\s+", " ", value).strip(" .")[:80]
    return value or fallback


def unknown_muxed_format(fmt):
    ext = format_extension(fmt)
    vcodec = fmt.get("vcodec")
    acodec = fmt.get("acodec")
    return vcodec in (None, "") and acodec in (None, "") and ext in ("mp4", "m4v", "mov", "webm", "mkv")


def codec_matches(fmt, requested):
    vcodec = fmt.get("vcodec")
    codec = str(vcodec or "none").lower()
    if requested == "auto":
        return codec != "none" or unknown_muxed_format(fmt)
    prefixes = {
        "h264": ("avc1", "avc3", "h264"),
        "hevc": ("hvc1", "hev1", "hevc", "h265"),
        "av1": ("av01", "av1"),
        "vp9": ("vp09", "vp9"),
    }
    return codec.startswith(prefixes.get(requested, (requested,)))


def format_extension(fmt):
    return str(fmt.get("ext") or "").lower()


def video_container_matches(fmt, requested):
    if requested in ("source", "mkv"):
        return True
    ext = format_extension(fmt)
    codec = str(fmt.get("vcodec") or "none").lower()
    if requested == "mp4":
        return ext in ("mp4", "m4v", "mov") and (
            codec.startswith(("avc1", "avc3", "h264", "hvc1", "hev1", "hevc", "h265", "av01", "av1"))
            or unknown_muxed_format(fmt)
        )
    if requested == "webm":
        return ext == "webm" and (
            codec.startswith(("vp8", "vp9", "vp09", "av01", "av1"))
            or unknown_muxed_format(fmt)
        )
    return False


def choose_video(info, opts):
    cap = None if opts["quality"] == "best" else int(opts["quality"])
    candidates = []
    for fmt in info.get("formats") or []:
        if not isinstance(fmt, dict) or not codec_matches(fmt, opts["codec"]):
            continue
        if not video_container_matches(fmt, opts["container"]):
            continue
        height = number(fmt.get("height")) or 0
        if cap is not None and height > cap:
            continue
        ext = format_extension(fmt)
        container_bonus = 0
        if opts["container"] != "source":
            container_bonus = 1 if ext == opts["container"] else 0
        candidates.append((
            height,
            number(fmt.get("width")) or 0,
            number(fmt.get("fps")) or 0,
            container_bonus,
            number(fmt.get("tbr")) or number(fmt.get("vbr")) or 0,
            fmt,
        ))
    if not candidates:
        return None
    return max(candidates, key=lambda value: value[:-1])[-1]


def audio_container_matches(fmt, requested):
    if requested not in ("mp4", "webm"):
        return True
    ext = format_extension(fmt)
    codec = str(fmt.get("acodec") or "none").lower()
    if requested == "mp4":
        return ext in ("m4a", "mp4", "aac") and codec.startswith(("mp4a", "aac"))
    return ext == "webm" and codec.startswith(("opus", "vorbis"))


def choose_audio(info, prefer_container=None, strict_container=False):
    candidates = []
    for fmt in info.get("formats") or []:
        if not isinstance(fmt, dict):
            continue
        acodec = str(fmt.get("acodec") or "none").lower()
        if acodec == "none" and not unknown_muxed_format(fmt):
            continue
        if strict_container and not audio_container_matches(fmt, prefer_container):
            continue
        vcodec = str(fmt.get("vcodec") or "none").lower()
        note = str(fmt.get("format_note") or "").lower()
        descriptive = any(word in note for word in ("descriptive", "description", "commentary"))
        ext = format_extension(fmt)
        candidates.append((
            1 if vcodec == "none" else 0,
            0 if descriptive else 1,
            1 if prefer_container and ext == prefer_container else 0,
            number(fmt.get("language_preference")) or 0,
            number(fmt.get("abr")) or number(fmt.get("tbr")) or 0,
            number(fmt.get("asr")) or 0,
            fmt,
        ))
    if not candidates:
        return None
    return max(candidates, key=lambda value: value[:-1])[-1]


def file_payload(info, path, fallback):
    return {
        "path": path,
        "extension": os.path.splitext(path)[1].lstrip(".").lower(),
        "formatId": str(info.get("format_id") or fallback.get("format_id") or ""),
        "vcodec": str(info.get("vcodec") or fallback.get("vcodec") or "none"),
        "acodec": str(info.get("acodec") or fallback.get("acodec") or "none"),
        "unknownMuxed": unknown_muxed_format(info) or unknown_muxed_format(fallback),
    }


def download_format(url, fmt, output_stem):
    check_cancelled()
    options = common_options()
    options.update({
        "noplaylist": True,
        "playlist_items": "1",
        "format": str(fmt.get("format_id")),
        "outtmpl": output_stem + ".%(ext)s",
        "progress_hooks": [progress_hook],
    })
    with yt_dlp.YoutubeDL(options) as ydl:
        downloaded = ydl.extract_info(url, download=True)
        media = first_media(downloaded) or {}
        path = existing_file(downloaded, ydl)
        if not path:
            raise RuntimeError("下载结束但没有找到媒体文件")
        return file_payload(media, path, fmt)


def entries_from_info(info):
    if isinstance(info, dict) and info.get("entries"):
        return [entry for entry in info.get("entries") if isinstance(entry, dict)]
    return [info] if isinstance(info, dict) else []


def matching_languages(source, requested):
    keys = list(source.keys())
    if not requested or any(str(lang).lower() in ("all", "*") for lang in requested):
        return keys
    selected = []
    for wanted in requested:
        wanted_lower = str(wanted).lower()
        exact = [key for key in keys if key.lower() == wanted_lower]
        related = [key for key in keys if key.lower().split("-")[0] == wanted_lower.split("-")[0]]
        for key in exact + related:
            if key not in selected:
                selected.append(key)
    return selected


def choose_subtitle_track(tracks, requested_format):
    valid = [track for track in tracks or [] if isinstance(track, dict) and isinstance(track.get("url"), str)]
    if not valid:
        return None, False
    if requested_format != "best":
        exact = [track for track in valid if str(track.get("ext") or "").lower() == requested_format]
        if exact:
            return exact[-1], True
    rank = {"vtt": 4, "srt": 3, "ttml": 2}
    best = max(valid, key=lambda track: rank.get(str(track.get("ext") or "").lower(), 1))
    return best, requested_format == "best"


def url_extension(url, declared, content_type=None):
    ext = str(declared or "").lower().lstrip(".")
    if ext:
        return ext
    path_ext = os.path.splitext(urllib.parse.urlparse(url).path)[1].lstrip(".").lower()
    if path_ext and len(path_ext) <= 8:
        return path_ext
    guessed = mimetypes.guess_extension((content_type or "").split(";")[0].strip()) or ""
    return guessed.lstrip(".") or "bin"


def download_url(url, destination_stem, declared_ext=None, headers=None):
    request = urllib.request.Request(url, headers=headers or {"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        ext = url_extension(response.geturl(), declared_ext, response.headers.get("Content-Type"))
        path = destination_stem + "." + ext
        with open(path, "wb") as output:
            while True:
                block = response.read(256 * 1024)
                if not block:
                    break
                output.write(block)
    if not os.path.isfile(path) or os.path.getsize(path) <= 0:
        raise RuntimeError("下载文件为空")
    return {"path": os.path.abspath(path), "extension": ext}


def item_url(entry):
    for key in ("webpage_url", "original_url", "url"):
        value = entry.get(key)
        if isinstance(value, str) and value.startswith(("http://", "https://")):
            return value
    return None


# ─── Main entry point ────────────────────────────────────────

try:
    import yt_dlp

    params = json.loads(os.environ.get("SCRIPTING_QUERY_PARAMETERS", "{}"))
    url = params.get("url")
    task_dir = params.get("taskDir")
    opts = params.get("options") or {}
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise ValueError("没有收到有效的 HTTP(S) 链接")
    if not isinstance(task_dir, str) or not os.path.isdir(task_dir):
        raise ValueError("高级下载任务目录无效")

    playlist_start = int(opts.get("playlistStart") or 1)
    playlist_end = int(opts.get("playlistEnd") or playlist_start)
    allow_playlist = bool(opts.get("playlist"))
    metadata_options = common_options()
    metadata_options.update({
        "noplaylist": not allow_playlist,
        "playliststart": playlist_start,
        "playlistend": playlist_end,
        "lazy_playlist": False,
    })
    atomic_progress({"status": "preparing", "stage": "metadata", "message": "正在解析媒体信息"})
    check_cancelled()
    with yt_dlp.YoutubeDL(metadata_options) as ydl:
        root_info = ydl.extract_info(url, download=False)
    entries = entries_from_info(root_info)[:50]
    if not entries:
        raise RuntimeError("链接中没有找到可下载的媒体")

    item_count = len(entries)
    atomic_progress({"itemCount": item_count})
    results = []
    failures = []

    for offset, initial in enumerate(entries):
        check_cancelled()
        item_index = offset + 1
        title = str(initial.get("title") or initial.get("id") or ("媒体 " + str(item_index)))
        media_id = str(initial.get("id") or "")
        source_url = item_url(initial)
        item_dir = os.path.join(task_dir, "item-" + str(item_index).zfill(2))
        os.makedirs(item_dir, exist_ok=False)
        atomic_progress({
            "status": "preparing",
            "stage": "metadata",
            "itemIndex": item_index,
            "itemCount": item_count,
            "title": title,
            "downloadedBytes": 0,
            "totalBytes": None,
            "percent": None,
            "speed": None,
            "eta": None,
            "message": "正在准备此项目",
        })
        try:
            if not source_url:
                raise RuntimeError("播放列表条目没有可独立下载的 HTTP(S) 地址，已跳过以避免重复下载第一项")
            info = initial
            if not info.get("formats"):
                single_options = common_options()
                single_options.update({"noplaylist": True, "playlist_items": "1"})
                with yt_dlp.YoutubeDL(single_options) as ydl:
                    info = first_media(ydl.extract_info(source_url, download=False)) or {}
            title = str(info.get("title") or title)
            media_id = str(info.get("id") or media_id)
            record = {
                "itemIndex": item_index,
                "title": title,
                "mediaId": media_id,
                "webpageUrl": str(info.get("webpage_url") or source_url),
                "subtitles": [],
            }

            atomic_progress({"stage": "media", "title": title, "message": "正在下载媒体流"})
            if opts.get("mediaType") == "audio":
                selected_audio = choose_audio(info)
                if not selected_audio:
                    raise RuntimeError("没有找到可用音频流")
                record["audioOnly"] = download_format(source_url, selected_audio, os.path.join(item_dir, "audio-source"))
            else:
                selected_video = choose_video(info, opts)
                if not selected_video:
                    raise RuntimeError("没有符合画质、容器与编码条件的视频流")
                selected = download_format(source_url, selected_video, os.path.join(item_dir, "video"))
                if str(selected_video.get("acodec") or "none").lower() != "none" or unknown_muxed_format(selected_video):
                    record["combined"] = selected
                else:
                    record["video"] = selected
                    selected_container = opts.get("container")
                    if selected_container == "source":
                        selected_container = "webm" if selected["extension"] == "webm" else "mp4" if selected["extension"] in ("mp4", "m4v", "mov") else None
                    selected_audio = choose_audio(
                        info,
                        selected_container,
                        selected_container in ("mp4", "webm"),
                    )
                    if selected_audio:
                        record["audio"] = download_format(source_url, selected_audio, os.path.join(item_dir, "audio"))
                    else:
                        failures.append({
                            "stage": "download", "message": "视频流已下载，但没有找到可配对的音频流",
                            "itemIndex": item_index, "title": title, "recoverable": True,
                        })

            subtitle_sources = []
            if opts.get("writeSubtitles"):
                subtitle_sources.append((False, info.get("subtitles") or {}))
            if opts.get("writeAutomaticSubtitles"):
                subtitle_sources.append((True, info.get("automatic_captions") or {}))
            for automatic, source in subtitle_sources:
                languages = matching_languages(source, opts.get("subtitleLanguages") or [])
                if not languages and (opts.get("subtitleLanguages") or []):
                    failures.append({
                        "stage": "subtitle", "message": ("自动" if automatic else "人工") + "字幕中没有匹配的语言",
                        "itemIndex": item_index, "title": title, "recoverable": True,
                    })
                for language in languages:
                    track, exact = choose_subtitle_track(source.get(language), opts.get("subtitleFormat") or "best")
                    if not track:
                        continue
                    atomic_progress({"stage": "subtitle", "message": "正在下载字幕 " + language})
                    try:
                        stem = os.path.join(item_dir, "subtitle-" + safe_component(language) + ("-auto" if automatic else "-manual"))
                        headers = dict(info.get("http_headers") or {})
                        headers.update(track.get("http_headers") or {})
                        downloaded = download_url(track["url"], stem, track.get("ext"), headers)
                        downloaded.update({
                            "language": language,
                            "automatic": automatic,
                            "requestedFormat": opts.get("subtitleFormat") or "best",
                        })
                        record["subtitles"].append(downloaded)
                    except Exception as subtitle_error:
                        failures.append({
                            "stage": "subtitle", "message": str(subtitle_error),
                            "itemIndex": item_index, "title": title, "recoverable": True,
                        })

            if opts.get("writeThumbnail"):
                thumbnail_url = info.get("thumbnail")
                if not thumbnail_url and info.get("thumbnails"):
                    thumbnail_url = (info.get("thumbnails")[-1] or {}).get("url")
                if isinstance(thumbnail_url, str):
                    atomic_progress({"stage": "thumbnail", "message": "正在下载缩略图"})
                    try:
                        record["thumbnail"] = download_url(
                            thumbnail_url,
                            os.path.join(item_dir, "thumbnail"),
                            headers=info.get("http_headers") or {},
                        )
                    except Exception as thumbnail_error:
                        failures.append({
                            "stage": "thumbnail", "message": str(thumbnail_error),
                            "itemIndex": item_index, "title": title, "recoverable": True,
                        })
                else:
                    failures.append({
                        "stage": "thumbnail", "message": "此项目没有可用缩略图",
                        "itemIndex": item_index, "title": title, "recoverable": True,
                    })

            results.append(record)
        except Exception as item_error:
            failures.append({
                "stage": "download", "message": str(item_error) or item_error.__class__.__name__,
                "itemIndex": item_index, "title": title, "recoverable": True,
            })

    atomic_progress({"status": "finished", "stage": "media", "message": "yt-dlp 下载阶段完成"})
    emit({"ok": True, "requestedItems": item_count, "items": results, "failures": failures})
except Exception as error:
    atomic_progress({"status": "error", "stage": "metadata", "message": str(error)})
    error_msg = str(error) or error.__class__.__name__
    emit({"ok": False, "error": error_msg})
    sys.exit(1)
