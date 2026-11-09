"""Normalize the supplied Daejeon bus stop CSVs for DT Sniper.

The source files are read only. The first file is the master stop inventory;
the second is used only for a conservative name-and-coordinate administrative
area crosswalk. ODsay IDs are intentionally left blank because neither source
file supplies ODsay station IDs.
"""
from __future__ import annotations

import csv
import json
import math
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent
PROJECT_ROOT = APP_DIR.parent
PRIMARY = PROJECT_ROOT / "대전광역시_버스정류장_위치정보_추출.csv"
SECONDARY = PROJECT_ROOT / "대전광역시_시내버스 기반정보_20250424.CSV"
OUTPUT_CSV = HERE / "stops_clean.csv"
OUTPUT_JS = APP_DIR / "stops_data.js"
REPORT = HERE / "cleaning_report.md"

DAEJEON_BOUNDS = (36.0, 37.0, 126.0, 128.0)  # min lat, max lat, min lon, max lon
ADMIN_MATCH_MAX_M = 100.0
CAMPUS_SEEDS = {
    "daejeon": (36.335, 127.459),
    "hanbat": (36.350, 127.300),
    "chungnam": (36.366, 127.344),
    "woosong": (36.338, 127.445),
}


def text(value: object) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", str(value or ""))).strip()


def mobile_code(value: str) -> str:
    value = text(value)
    if not value:
        return ""
    try:
        number = float(value)
        if number.is_integer():
            return str(int(number))
    except ValueError:
        pass
    return value


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rad = math.radians
    dlat, dlon = rad(lat2 - lat1), rad(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.sin(dlon / 2) ** 2
    return 12_742_000 * math.asin(math.sqrt(a))


def parse_primary_coords(lat_raw: str, lon_raw: str) -> tuple[float, float, str]:
    lat, lon = float(text(lat_raw)), float(text(lon_raw))
    min_lat, max_lat, min_lon, max_lon = DAEJEON_BOUNDS
    if min_lat <= lat <= max_lat and min_lon <= lon <= max_lon:
        return lat, lon, "as_provided"
    # Five source rows have latitude/longitude transposed. Correct only when
    # swapping places both coordinates inside the Daejeon bounds.
    if min_lat <= lon <= max_lat and min_lon <= lat <= max_lon:
        return lon, lat, "swapped_corrected"
    raise ValueError(f"coordinate outside expected Daejeon bounds: {lat_raw}, {lon_raw}")


def read_csv(path: Path, encoding: str) -> list[dict[str, str]]:
    with path.open("r", encoding=encoding, newline="") as handle:
        return list(csv.DictReader(handle))


def build_crosswalk(secondary: list[dict[str, str]]) -> dict[str, list[tuple[float, float, dict[str, str]]]]:
    by_name: dict[str, list[tuple[float, float, dict[str, str]]]] = defaultdict(list)
    for row in secondary:
        try:
            lat, lon = float(text(row["와이좌표"])), float(text(row["엑스좌표"]))
        except (KeyError, ValueError):
            continue
        by_name[text(row["정류장명"])].append((lat, lon, row))
    return by_name


def crosswalk_admin(name: str, lat: float, lon: float, by_name: dict[str, list[tuple[float, float, dict[str, str]]]]) -> dict[str, str]:
    candidates = sorted(
        ((haversine_m(lat, lon, other_lat, other_lon), other)
         for other_lat, other_lon, other in by_name.get(name, [])),
        key=lambda item: item[0],
    )
    blank = {"admin_district": "", "admin_dong": "", "secondary_stop_code": "",
             "national_code": "", "settlement_code": "", "admin_match_distance_m": "",
             "admin_match_status": "no_same_name"}
    if not candidates:
        return blank
    distance, row = candidates[0]
    blank["admin_match_distance_m"] = f"{distance:.1f}"
    if distance > ADMIN_MATCH_MAX_M:
        blank["admin_match_status"] = "same_name_too_far"
        return blank
    # A near-tie with conflicting administrative fields is kept unmatched.
    if len(candidates) > 1 and candidates[1][0] - distance < 5:
        second = candidates[1][1]
        if (text(row.get("시군구명")), text(row.get("읍면동명"))) != (text(second.get("시군구명")), text(second.get("읍면동명"))):
            blank["admin_match_status"] = "ambiguous_admin_match"
            return blank
    blank.update({
        "admin_district": text(row.get("시군구명")),
        "admin_dong": text(row.get("읍면동명")),
        "secondary_stop_code": text(row.get("정류장 코드")),
        "national_code": text(row.get("국토부 코드")),
        "settlement_code": text(row.get("정산 코드")),
        "admin_match_status": "matched_name_and_within_100m",
    })
    return blank


def main() -> None:
    primary = read_csv(PRIMARY, "utf-8-sig")
    secondary = read_csv(SECONDARY, "cp949")
    crosswalk = build_crosswalk(secondary)
    cleaned: list[dict[str, str]] = []
    coordinate_status = Counter()
    excluded: list[str] = []
    corrected_ids: list[str] = []
    seen_ids: set[str] = set()

    for row_number, row in enumerate(primary, start=2):
        stop_id = text(row.get("정류장번호"))
        name = text(row.get("정류장명"))
        if not stop_id or not name or stop_id in seen_ids:
            excluded.append(f"row {row_number}: missing or duplicate primary ID/name")
            continue
        try:
            lat, lon, coord_status = parse_primary_coords(row.get("위도", ""), row.get("경도", ""))
        except (ValueError, TypeError) as exc:
            excluded.append(f"row {row_number} ({stop_id}): {exc}")
            continue
        seen_ids.add(stop_id)
        coordinate_status[coord_status] += 1
        if coord_status == "swapped_corrected":
            corrected_ids.append(stop_id)
        admin = crosswalk_admin(name, lat, lon, crosswalk)
        cleaned.append({
            "stop_id": stop_id,
            "stop_name": name,
            "latitude": f"{lat:.7f}",
            "longitude": f"{lon:.7f}",
            "admin_district": admin["admin_district"],
            "admin_dong": admin["admin_dong"],
            "collected_at": text(row.get("정보수집일")),
            "mobile_short_code": mobile_code(row.get("모바일단축번호", "")),
            "city_code": text(row.get("도시코드")),
            "city_name": text(row.get("도시명")),
            "managing_city": text(row.get("관리도시명")),
            "secondary_stop_code": admin["secondary_stop_code"],
            "national_code": admin["national_code"],
            "settlement_code": admin["settlement_code"],
            "admin_match_distance_m": admin["admin_match_distance_m"],
            "admin_match_status": admin["admin_match_status"],
            "coordinate_status": coord_status,
            # This source does not carry ODsay's stationID. Resolve and fill it later.
            "odsay_station_id": "",
        })

    cleaned.sort(key=lambda r: (r["stop_name"].casefold(), r["admin_district"], r["admin_dong"], r["mobile_short_code"], r["stop_id"]))
    fieldnames = list(cleaned[0]) if cleaned else []
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(cleaned)

    stops_js = []
    for row in cleaned:
        district = row["admin_district"] or row["city_name"] or "행정구역 미매칭"
        dong = row["admin_dong"]
        mobile = row["mobile_short_code"] or row["stop_id"][-4:]
        row["label"] = f"{row['stop_name']} · {district}{' ' + dong if dong else ''} · {mobile} · {row['stop_id']}"
        stops_js.append({
            "id": row["stop_id"], "name": row["stop_name"],
            "lat": float(row["latitude"]), "lon": float(row["longitude"]),
            "district": row["admin_district"], "dong": row["admin_dong"],
            "mobile_code": row["mobile_short_code"], "label": row["label"],
            "odsay_station_id": row["odsay_station_id"],
        })

    defaults = {}
    for key, (seed_lat, seed_lon) in CAMPUS_SEEDS.items():
        nearest = min(cleaned, key=lambda r: haversine_m(seed_lat, seed_lon, float(r["latitude"]), float(r["longitude"])))
        defaults[key] = nearest["stop_id"]
    with OUTPUT_JS.open("w", encoding="utf-8") as handle:
        handle.write("// Generated from data/stops_clean.csv by clean_bus_stops.py.\n")
        handle.write("window.DT_SNIPER_STOPS = ")
        handle.write(json.dumps(stops_js, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
        handle.write(";\nwindow.DT_SNIPER_DEFAULT_STOP_IDS = ")
        handle.write(json.dumps(defaults, ensure_ascii=False, separators=(",", ":")))
        handle.write(";\n")

    admin_counts = Counter(row["admin_match_status"] for row in cleaned)
    duplicate_names = Counter(row["stop_name"] for row in cleaned)
    secondary_codes = [text(row.get("정류장 코드")) for row in secondary if text(row.get("정류장 코드"))]
    secondary_code_counts = Counter(secondary_codes)
    primary_ids = [text(row.get("정류장번호")) for row in primary if text(row.get("정류장번호"))]
    collected_dates = sorted({text(row.get("정보수집일")) for row in primary if text(row.get("정보수집일"))})
    missing_required = sum(not all(text(row.get(key)) for key in ("정류장번호", "정류장명", "위도", "경도")) for row in primary)
    report = [
        "# 정류장 데이터 정제 보고서", "",
        "## 입력 파일과 식별자", "",
        f"- 위치정보 원본: `{PRIMARY.name}` ({len(primary):,}행, UTF-8 BOM)",
        "  - 컬럼: 정류장번호, 정류장명, 위도, 경도, 정보수집일, 모바일단축번호, 도시코드, 도시명, 관리도시명",
        f"  - `정류장번호` 고유값 {len(set(primary_ids)):,}/{len(primary_ids):,}; 주 ID로 보존. 좌표는 위도·경도(WGS84), 날짜는 정보수집일 사용",
        f"- 기반정보 원본: `{SECONDARY.name}` ({len(secondary):,}행, CP949)",
        "  - 컬럼: 순번, 국토부 코드, 정산 코드, 정류장 코드, 정류장명, 행정구역코드, 시도명, 시군구명, 읍면동명, 버스안내단말기 설치유무, 와이좌표, 엑스좌표",
        f"  - `정류장 코드` 고유값 {len(set(secondary_codes)):,}/{len(secondary_codes):,}; 중복 코드 종류 {sum(n > 1 for n in secondary_code_counts.values()):,}, 중복 초과 행 {len(secondary_codes) - len(set(secondary_codes)):,}. 세 코드와 위치정보 파일의 정류장번호는 별도 체계로 취급",
        "  - 행정구역(시군구·읍면동)을 이름이 같고 좌표가 100m 이내인 경우에만 보조 매칭",
        "- ODsay `stationID`: 두 파일에서 제공되지 않아 빈 별도 필드로 유지. ODsay 검색/경로 응답에서 추후 연결해야 함.",
        "  ODsay 경로 검색은 좌표를 받으므로, 원본 정류장번호를 ODsay ID로 직접 사용하지 않음.", "",
        "## 정제 결과", "",
        f"- 정제 행: {len(cleaned):,}; 제외 행: {len(excluded):,}",
        f"- 정류장 ID·이름·좌표 필수값 누락: {missing_required:,}행; 수집일 값: {', '.join(collected_dates) if collected_dates else '없음'}",
        f"- 좌표: 원본 정상 {coordinate_status['as_provided']:,}; 뒤바뀜 자동 교정 {coordinate_status['swapped_corrected']:,}",
        f"- 좌표 교정 ID: {', '.join(corrected_ids) if corrected_ids else '없음'}; 좌표 누락·대전권 범위 밖 행은 제외 여부를 아래에 기록",
        f"- 행정구역 매칭 상태: {dict(admin_counts)}",
        f"- 중복 정류장명 그룹: {sum(n > 1 for n in duplicate_names.values()):,}. 이름 중복은 오류로 제거하지 않고 정류장 ID·좌표별로 보존.",
        "- 모든 정제 행의 stop_id는 고유하며, 앱 선택 라벨에는 구/동·모바일 단축번호·전체 정류장 ID를 넣음.",
        f"- 앱 초기 선택값(대학 중심의 대략 좌표에 가장 가까운 정류장): {', '.join(f'{key}={value}' for key, value in defaults.items())}. 정문/승차 정류장으로 검증된 값은 아니며 검색으로 변경 가능.",
        "- 원본 CSV는 변경하지 않음.", "",
    ]
    if excluded:
        report.extend(["## 제외 행", "", *[f"- {item}" for item in excluded], ""])
    REPORT.write_text("\n".join(report), encoding="utf-8")
    print(f"cleaned={len(cleaned)} excluded={len(excluded)} coordinate_corrections={coordinate_status['swapped_corrected']} admin_matches={admin_counts['matched_name_and_within_100m']} output={OUTPUT_CSV}")


if __name__ == "__main__":
    main()
