"""Quick download runner: inspect, download (compatible), downloadSeparate (native merge).

Expects shared.py to be prepended. Sets globals: MARKER, progress_path,
cookie_file_path, cancel_token_path, then dispatches based on "action" param.
"""
import uuid

PROGRESS_MESSAGES = {
    "media": "正在下载媒体",
    "video": "正在下载视频流",
    "audio": "正在下载音频流",
}


def make_progress_hook(stage):
    def progress_hook(data):
        check_cancelled()
        downloaded = number(data.get("downloaded_bytes")) or 0
        total = number(data.get("total_bytes")) or number(data.get("total_bytes_estimate"))
        status = data.get("status")
        if status == "finished":
            percent = 100
            if total is not None:
                downloaded = max(downloaded, total)
            message = {
                "media": "媒体下载完成",
                "video": "视频流下载完成",
                "audio": "音频流下载完成",
            }[stage]
        else:
            percent = min(100, max(0, downloaded * 100 / total)) if total and total > 0 else None
            message = PROGRESS_MESSAGES[stage]
        atomic_write_json(progress_path, {
            "stage": stage,
            "percent": percent,
            "bytes": downloaded,
            "total": total,
            "speed": number(data.get("speed")),
            "eta": number(data.get("eta")),
            "message": message,
        })
    return progress_hook


def choose_native_pair(info):
    formats = info.get("formats") or [] if isinstance(info, dict) else []
    videos_h264 = []
    videos_hevc = []
    audios = []

    for fmt in formats:
        if not isinstance(fmt, dict):
            continue
        ext = str(fmt.get("ext") or "").lower()
        vcodec = str(fmt.get("vcodec") or "none").lower()
        acodec = str(fmt.get("acodec") or "none").lower()
        height = number(fmt.get("height"))
        fps = number(fmt.get("fps"))

        if vcodec != "none" and acodec == "none" and ext == "mp4":
            if height is not None and height > 2160:
                continue
            if fps is not None and fps > 60.5:
                continue
            if vcodec.startswith(("avc1", "avc3")):
                videos_h264.append(fmt)
            elif vcodec.startswith(("hvc1", "hev1", "hevc")):
                videos_hevc.append(fmt)
        elif acodec != "none" and vcodec == "none":
            if ext in ("m4a", "mp4") and acodec.startswith("mp4a"):
                audios.append(fmt)

    def video_score(fmt):
        return (
            number(fmt.get("height")) or 0,
            number(fmt.get("width")) or 0,
            number(fmt.get("fps")) or 0,
            number(fmt.get("tbr")) or number(fmt.get("vbr")) or 0,
        )

    def audio_score(fmt):
        note = str(fmt.get("format_note") or "").lower()
        descriptive_penalty = -1 if any(word in note for word in ("descriptive", "description", "commentary")) else 0
        return (
            descriptive_penalty,
            number(fmt.get("language_preference")) or 0,
            number(fmt.get("preference")) or 0,
            number(fmt.get("source_preference")) or 0,
            number(fmt.get("abr")) or number(fmt.get("tbr")) or 0,
            number(fmt.get("asr")) or 0,
        )

    videos = videos_h264 if videos_h264 else videos_hevc
    if not videos or not audios:
        return None
    return max(videos, key=video_score), max(audios, key=audio_score)


def media_payload(info):
    info = first_media(info) or {}
    pair = choose_native_pair(info)
    duration = number(info.get("duration"))
    return {
        "title": str(info.get("title") or info.get("id") or "未命名视频"),
        "mediaId": str(info.get("id") or ""),
        "site": str(info.get("extractor_key") or info.get("extractor") or "未知站点"),
        "uploader": str(info.get("uploader") or info.get("channel") or ""),
        "duration": duration,
        "webpageUrl": str(info.get("webpage_url") or info.get("original_url") or ""),
        "thumbnail": info.get("thumbnail") if isinstance(info.get("thumbnail"), str) else None,
        "extension": info.get("ext") if isinstance(info.get("ext"), str) else None,
        "nativeMergeAvailable": pair is not None,
        "nativeVideoHeight": number(pair[0].get("height")) if pair else None,
    }


def cleanup_stale_jobs(output_dir):
    jobs_root = os.path.join(output_dir, ".native-merge-jobs")
    if not os.path.isdir(jobs_root):
        return
    now = __import__("time").time()
    for name in os.listdir(jobs_root):
        path = os.path.join(jobs_root, name)
        if not name.startswith("job-") or not os.path.isdir(path):
            continue
        try:
            if now - os.path.getmtime(path) > 24 * 60 * 60:
                shutil.rmtree(path, ignore_errors=True)
        except OSError:
            pass


def download_one(url, format_id, output_template, stage):
    check_cancelled()
    options = common_options()
    options["noplaylist"] = True
    options["playlist_items"] = "1"
    options["format"] = str(format_id)
    options["outtmpl"] = output_template
    options["progress_hooks"] = [make_progress_hook(stage)]
    atomic_write_json(progress_path, {
        "stage": stage, "percent": 0, "bytes": 0, "total": None,
        "speed": None, "eta": None, "message": PROGRESS_MESSAGES[stage],
    })
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        path = existing_file(info, ydl)
        if not path:
            raise RuntimeError("下载过程结束，但没有找到完整的独立媒体文件")
        return first_media(info) or {}, path


def separate_file_payload(info, path, fallback):
    return {
        "filePath": path,
        "fileSize": os.path.getsize(path),
        "formatId": str(info.get("format_id") or fallback.get("format_id") or ""),
        "extension": os.path.splitext(path)[1].lstrip(".").lower(),
        "vcodec": str(info.get("vcodec") or fallback.get("vcodec") or "none"),
        "acodec": str(info.get("acodec") or fallback.get("acodec") or "none"),
        "width": number(info.get("width")) or number(fallback.get("width")),
        "height": number(info.get("height")) or number(fallback.get("height")),
        "fps": number(info.get("fps")) or number(fallback.get("fps")),
    }


# ─── Main entry point ────────────────────────────────────────

job_dir = None

try:
    import yt_dlp

    params = json.loads(os.environ.get("SCRIPTING_QUERY_PARAMETERS", "{}"))
    action = params.get("action")
    url = params.get("url")
    output_dir = params.get("outputDir")
    progress_path = params.get("progressPath")
    cookie_file_path = params.get("cookieFilePath")
    cancel_token_path = params.get("cancelTokenPath")
    if action not in ("inspect", "download", "downloadSeparate"):
        raise ValueError("无效操作")
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        raise ValueError("没有收到有效的 HTTP(S) 链接")
    if not isinstance(output_dir, str) or not output_dir:
        raise ValueError("没有收到下载目录")

    os.makedirs(output_dir, exist_ok=True)
    cleanup_stale_jobs(output_dir)

    if action == "inspect":
        check_cancelled()
        options = common_options()
        options["noplaylist"] = True
        options["playlist_items"] = "1"
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
            payload = media_payload(info)
            payload["ok"] = True
            emit(payload)

    elif action == "download":
        check_cancelled()
        options = common_options()
        options["noplaylist"] = True
        options["playlist_items"] = "1"
        options["format"] = (
            "b[ext=mp4][vcodec^=avc1][acodec^=mp4a]"
            "/b[ext=mp4][acodec^=mp4a]"
            "/b[acodec!=none][vcodec!=none]"
            "/ba"
        )
        options["outtmpl"] = os.path.join(output_dir, "%(title).80B [%(id)s].%(ext)s")
        options["progress_hooks"] = [make_progress_hook("media")]
        atomic_write_json(progress_path, {
            "stage": "media", "percent": 0, "bytes": 0, "total": None,
            "speed": None, "eta": None, "message": PROGRESS_MESSAGES["media"],
        })
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=True)
            media = first_media(info)
            payload = media_payload(media)
            path = existing_file(info, ydl)
            if not path:
                raise RuntimeError("下载过程结束，但没有找到完整的输出文件")
            payload["filePath"] = path
            payload["fileSize"] = os.path.getsize(path)
            payload["extension"] = os.path.splitext(path)[1].lstrip(".").lower() or payload.get("extension")
            payload["ok"] = True
            emit(payload)

    else:
        check_cancelled()
        probe_options = common_options()
        probe_options["noplaylist"] = True
        probe_options["playlist_items"] = "1"
        with yt_dlp.YoutubeDL(probe_options) as ydl:
            probe_info = ydl.extract_info(url, download=False)
        media = first_media(probe_info) or {}
        pair = choose_native_pair(media)
        if not pair:
            raise RuntimeError("没有找到可由 iOS 原生合并的 MP4 视频流和 AAC 音频流")
        video_format, audio_format = pair

        jobs_root = os.path.join(output_dir, ".native-merge-jobs")
        os.makedirs(jobs_root, exist_ok=True)
        job_dir = os.path.join(jobs_root, "job-" + uuid.uuid4().hex)
        os.makedirs(job_dir, exist_ok=False)

        video_info, video_path = download_one(
            url,
            video_format.get("format_id"),
            os.path.join(job_dir, "video.%(ext)s"),
            "video",
        )
        audio_info, audio_path = download_one(
            url,
            audio_format.get("format_id"),
            os.path.join(job_dir, "audio.%(ext)s"),
            "audio",
        )

        payload = media_payload(media)
        payload.update({
            "ok": True,
            "jobDir": job_dir,
            "video": separate_file_payload(video_info, video_path, video_format),
            "audio": separate_file_payload(audio_info, audio_path, audio_format),
        })
        emit(payload)
except Exception as error:
    if job_dir and os.path.isdir(job_dir):
        shutil.rmtree(job_dir, ignore_errors=True)
    error_msg = str(error) or error.__class__.__name__
    if error_msg == "__USER_CANCELLED__":
        emit({"ok": False, "error": "__USER_CANCELLED__"})
    else:
        emit({"ok": False, "error": error_msg})
    sys.exit(1)
