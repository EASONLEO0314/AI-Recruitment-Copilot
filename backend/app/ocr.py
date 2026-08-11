"""Local OCR helpers for explicit user-triggered resume reads."""

from __future__ import annotations

import base64
import re
import shutil
import subprocess


DATA_URL_PATTERN = re.compile(r"^data:image/(png|jpeg|jpg);base64,(?P<data>[A-Za-z0-9+/=\s]+)$")
BASIC_INFO_PATTERN = re.compile(
    r"^(?:\d+\s*(?:年|岁)(?:经验)?|本科|硕士|博士|大专|高中|中专|学历|男|女|"
    r"在职.*|离职.*|随时到岗|应届生|工作|教育|项目|技能|"
    r".+工程师|.+经理|.+主管|.+负责人|.+顾问|.+专家|.+架构师)$",
)
TOKEN_PATTERN = re.compile(r"[\u4e00-\u9fffA-Za-z0-9#+._-]{1,40}")


def decode_image_data_url(image_data_url: str) -> bytes | None:
    match = DATA_URL_PATTERN.match(image_data_url)
    if not match:
        return None
    try:
        data = base64.b64decode(match.group("data"), validate=True)
    except ValueError:
        return None
    if not data or len(data) > 4_500_000:
        return None
    return data


def available_tesseract_languages() -> str:
    command = shutil.which("tesseract")
    if not command:
        return "eng"
    try:
        result = subprocess.run(
            [command, "--list-langs"],
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "eng"
    languages = set(result.stdout.split())
    return "chi_sim+eng" if "chi_sim" in languages else "eng"


def run_tesseract(image: bytes) -> tuple[bool, str]:
    command = shutil.which("tesseract")
    if not command:
        return False, ""
    try:
        result = subprocess.run(
            [command, "stdin", "stdout", "-l", available_tesseract_languages(), "--psm", "6"],
            input=image,
            check=False,
            capture_output=True,
            timeout=8,
        )
    except (OSError, subprocess.TimeoutExpired):
        return True, ""
    if result.returncode != 0:
        return True, ""
    return True, result.stdout.decode("utf-8", errors="ignore")


def extract_skill_tokens(text: str) -> list[str]:
    values: list[str] = []
    seen: set[str] = set()
    for match in TOKEN_PATTERN.finditer(text):
        token = match.group(0).strip("._-")
        if (
            not token
            or token in seen
            or BASIC_INFO_PATTERN.match(token)
            or token.isdigit()
            or (re.fullmatch(r"[\u4e00-\u9fff]+", token) and len(token) > 8)
        ):
            continue
        seen.add(token)
        values.append(token)
        if len(values) == 20:
            break
    return values


def ocr_skills_from_data_url(image_data_url: str) -> tuple[bool, list[str]]:
    image = decode_image_data_url(image_data_url)
    if image is None:
        return True, []
    available, text = run_tesseract(image)
    if not available:
        return False, []
    return True, extract_skill_tokens(text)
