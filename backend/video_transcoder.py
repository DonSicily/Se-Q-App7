"""
Video Transcoding Service using FFmpeg
WhatsApp-style compression for minimal file sizes
"""

import subprocess
import os
import logging
import asyncio
from pathlib import Path
from datetime import datetime
import uuid
import shutil
from typing import Optional, Tuple
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Thread pool for CPU-intensive transcoding
_executor = ThreadPoolExecutor(max_workers=2)

# Transcoding profiles — WhatsApp-style compression
# Target: ~1.5-2MB per minute of video at acceptable quality
PROFILES = {
    'ultra_compressed': {
        'resolution': '640x360',   # 360p — matches WhatsApp default
        'video_bitrate': '200k',   # 200 Kbps video
        'audio_bitrate': '32k',    # 32 Kbps mono audio (WhatsApp uses 32-40k)
        'preset': 'veryfast',
        'crf': 35,                 # Aggressive compression (28=high quality, 35=WhatsApp-like)
        'max_file_mb': 4,
    },
    'standard': {
        'resolution': '854x480',   # 480p
        'video_bitrate': '400k',
        'audio_bitrate': '48k',
        'preset': 'fast',
        'crf': 30,
        'max_file_mb': 8,
    },
    'quality': {
        'resolution': '1280x720',  # 720p — only for short clips
        'video_bitrate': '800k',
        'audio_bitrate': '64k',
        'preset': 'medium',
        'crf': 26,
        'max_file_mb': 15,
    }
}

# Default profile for emergency video reports
DEFAULT_PROFILE = 'ultra_compressed'

# Maximum duration for synchronous transcoding (seconds)
SYNC_TRANSCODE_MAX_DURATION = 60  # 1 minute


def get_video_info(input_path: str) -> dict:
    """Get video duration, resolution, and size using FFprobe"""
    try:
        cmd = [
            'ffprobe', '-v', 'quiet',
            '-print_format', 'json',
            '-show_format', '-show_streams',
            input_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            logger.error(f"FFprobe failed: {result.stderr}")
            return {}
        
        import json
        data = json.loads(result.stdout)
        
        # Extract info
        format_info = data.get('format', {})
        video_stream = next((s for s in data.get('streams', []) if s.get('codec_type') == 'video'), {})
        
        return {
            'duration': float(format_info.get('duration', 0)),
            'size_bytes': int(format_info.get('size', 0)),
            'size_mb': int(format_info.get('size', 0)) / (1024 * 1024),
            'width': int(video_stream.get('width', 0)),
            'height': int(video_stream.get('height', 0)),
            'bitrate': int(format_info.get('bit_rate', 0)),
            'codec': video_stream.get('codec_name', 'unknown'),
        }
    except Exception as e:
        logger.error(f"Error getting video info: {e}")
        return {}


def transcode_video_sync(
    input_path: str,
    output_path: str,
    profile: str = DEFAULT_PROFILE
) -> Tuple[bool, str, dict]:
    """
    Synchronously transcode video using FFmpeg
    Returns: (success, message, info_dict)
    """
    try:
        settings = PROFILES.get(profile, PROFILES[DEFAULT_PROFILE])
        
        # Get input info first
        input_info = get_video_info(input_path)
        logger.info(f"Input video: {input_info.get('size_mb', 0):.2f}MB, {input_info.get('duration', 0):.1f}s")
        
        # FFmpeg command for WhatsApp-style compression
        cmd = [
            'ffmpeg', '-y',           # overwrite output
            '-i', input_path,
            # ── Video ──────────────────────────────────────────────────────
            '-c:v', 'libx264',        # H.264 — maximum device compatibility
            '-preset', settings['preset'],
            '-crf', str(settings['crf']),
            '-b:v', settings['video_bitrate'],
            '-maxrate', settings['video_bitrate'],
            '-bufsize', f"{int(settings['video_bitrate'].replace('k','')) * 2}k",
            # Scale to target resolution, preserving aspect ratio, pad with black
            '-vf', (
                f"scale={settings['resolution']}:"
                f"force_original_aspect_ratio=decrease,"
                f"pad={settings['resolution']}:(ow-iw)/2:(oh-ih)/2:black"
            ),
            # ── Audio ──────────────────────────────────────────────────────
            '-c:a', 'aac',
            '-b:a', settings['audio_bitrate'],
            '-ar', '44100',           # standard sample rate
            '-ac', '1',               # mono — halves audio data (WhatsApp uses mono)
            # ── Container / compatibility ───────────────────────────────────
            '-movflags', '+faststart', # progressive download / streaming
            '-pix_fmt', 'yuv420p',    # broadest player compatibility
            '-profile:v', 'baseline', # H.264 baseline = max device support
            '-level', '3.0',
            # ── Strip metadata to shrink file further ────────────────────
            '-map_metadata', '-1',
            output_path
        ]
        
        logger.info(f"Starting transcode with profile '{profile}'...")
        start_time = datetime.now()
        
        result = subprocess.run(
            cmd, 
            capture_output=True, 
            text=True, 
            timeout=300  # 5 minute timeout
        )
        
        elapsed = (datetime.now() - start_time).total_seconds()
        
        if result.returncode != 0:
            logger.error(f"FFmpeg failed: {result.stderr}")
            return False, f"Transcoding failed: {result.stderr[:200]}", {}
        
        # Get output info
        output_info = get_video_info(output_path)
        
        compression_ratio = 0
        if input_info.get('size_bytes', 0) > 0:
            compression_ratio = (1 - output_info.get('size_bytes', 0) / input_info['size_bytes']) * 100
        
        logger.info(
            f"Transcode complete in {elapsed:.1f}s: "
            f"{input_info.get('size_mb', 0):.2f}MB → {output_info.get('size_mb', 0):.2f}MB "
            f"({compression_ratio:.1f}% reduction)"
        )
        
        return True, "Transcoding successful", {
            'input_size_mb': input_info.get('size_mb', 0),
            'output_size_mb': output_info.get('size_mb', 0),
            'compression_ratio': compression_ratio,
            'duration': output_info.get('duration', 0),
            'elapsed_seconds': elapsed,
            'profile': profile
        }
        
    except subprocess.TimeoutExpired:
        logger.error("Transcoding timeout")
        return False, "Transcoding timed out", {}
    except Exception as e:
        logger.error(f"Transcoding error: {e}")
        return False, str(e), {}


async def transcode_video_async(
    input_path: str,
    output_path: str,
    profile: str = DEFAULT_PROFILE
) -> Tuple[bool, str, dict]:
    """Async wrapper for transcoding - runs in thread pool"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor,
        transcode_video_sync,
        input_path,
        output_path,
        profile
    )


def should_transcode_sync(input_path: str) -> bool:
    """Determine if video should be transcoded synchronously or queued"""
    info = get_video_info(input_path)
    duration = info.get('duration', 0)
    return duration <= SYNC_TRANSCODE_MAX_DURATION


def select_profile(input_path: str, target_size_mb: float = 7.0) -> str:
    """Select appropriate profile based on input video"""
    info = get_video_info(input_path)
    duration = info.get('duration', 0)
    
    if duration <= 0:
        return DEFAULT_PROFILE
    
    # Calculate target bitrate to achieve target size
    # target_size_mb = (bitrate_kbps * duration_sec) / 8000
    # bitrate_kbps = (target_size_mb * 8000) / duration_sec
    target_bitrate = (target_size_mb * 8000) / duration
    
    if target_bitrate < 400:
        return 'ultra_compressed'
    elif target_bitrate < 700:
        return 'standard'
    else:
        return 'quality'


class TranscodeQueue:
    """Simple in-memory queue for background transcoding"""
    
    def __init__(self):
        self.queue = asyncio.Queue()
        self.processing = {}
        self.completed = {}
        self._worker_task = None
    
    async def start_worker(self):
        """Start background worker"""
        if self._worker_task is None:
            self._worker_task = asyncio.create_task(self._worker())
            logger.info("Transcode worker started")
    
    async def _worker(self):
        """Background worker that processes queue"""
        while True:
            try:
                job_id, input_path, output_path, profile, callback = await self.queue.get()
                
                self.processing[job_id] = {
                    'status': 'processing',
                    'started_at': datetime.utcnow()
                }
                
                success, message, info = await transcode_video_async(
                    input_path, output_path, profile
                )
                
                self.completed[job_id] = {
                    'status': 'completed' if success else 'failed',
                    'message': message,
                    'info': info,
                    'completed_at': datetime.utcnow()
                }
                
                del self.processing[job_id]
                
                if callback:
                    await callback(job_id, success, message, info)
                
                self.queue.task_done()
                
            except Exception as e:
                logger.error(f"Worker error: {e}")
    
    async def enqueue(
        self,
        input_path: str,
        output_path: str,
        profile: str = DEFAULT_PROFILE,
        callback=None
    ) -> str:
        """Add job to queue, returns job_id"""
        job_id = str(uuid.uuid4())
        await self.queue.put((job_id, input_path, output_path, profile, callback))
        return job_id
    
    def get_status(self, job_id: str) -> dict:
        """Get job status"""
        if job_id in self.processing:
            return self.processing[job_id]
        if job_id in self.completed:
            return self.completed[job_id]
        return {'status': 'queued'}


# Global queue instance
transcode_queue = TranscodeQueue()
