# RearGuard nuScenes 사양 확인 체크리스트

> 관련 문서: RearGuard 데이터 전처리 기법 및 순서 설계 보고서 v0.2 (이 체크리스트 결과 반영 완료)
> 목적: 설계 보고서 중 기억에 기반해 작성된 nuScenes 세부 사양을 공식 자료와 실제 데이터로 확인한다.

---

## 1. 확인할 곳

| 출처 | 주소 | 주로 확인할 내용 |
|---|---|---|
| 공식 웹사이트 | nuscenes.org | 데이터 구성, 센서 배치, 수집 도시, 데이터 형식 설명, 라이선스 |
| 개발 도구 저장소 | github.com/nutonomy/nuscenes-devkit | 튜토리얼(`python-sdk/tutorials`), 제공 스크립트(2D 변환 등) |
| 실제 데이터 | nuScenes mini 다운로드 후 직접 출력 | 장면 수, 카테고리 이름, 박스 정보 필드, 이미지 크기 |

신뢰도 순서: **실제 데이터 > 공식 문서 > 기억**. 셋이 다르면 실제 데이터를 따른다.

---

## 2. 실제 데이터 확인용 코드 (Colab)

```python
# devkit 설치
!pip install nuscenes-devkit

from nuscenes.nuscenes import NuScenes

# dataroot는 mini 데이터를 압축 해제한 실제 경로로 바꾼다
nusc = NuScenes(version='v1.0-mini', dataroot='/content/nuscenes', verbose=True)

nusc.list_scenes()                  # 장면 목록과 설명(description)
nusc.list_categories()              # 카테고리 이름 목록
print(nusc.visibility)              # 가시성 등급 구간
print(nusc.sample_annotation[0])    # 정답 박스 하나의 필드 (num_lidar_pts 등)
print([s['channel'] for s in nusc.sensor])   # 센서(카메라) 이름 목록
```

> 위 코드의 함수·필드 이름도 기억 기반이다. 오류가 나면 devkit 튜토리얼 노트북의 사용법을 따른다.

---

## 3. 체크리스트

상태 표기: ⬜ 미확인 / ✅ 일치 / ✏️ 수정 필요

| # | 확인 항목 | 보고서 기재 내용 | 보고서 위치 | 확인 방법 | 상태 | 확인 결과 | 출처·확인일 |
|---|---|---|---|---|---|---|---|
| 1 | mini의 장면 개수 | 10개 | A1 | `list_scenes()` 결과 개수 | ✅ | 10개 (scene-0061, 0103, 0553, 0655, 0757, 0796, 0916, 1077, 1094, 1100). 위치: 보스턴 4개, 싱가포르 6개 | [D1], 2026-10-07 |
| 2 | 장면 설명(description)에 night, rain 단어 사용 여부 | 해당 단어로 야간·우천 장면 제외 | A1 | `list_scenes()` 결과 읽기, 제외 대상 장면 사진 눈으로 확인 | ✅ | `Night`로 시작하는 장면 3개: scene-1077, 1094, 1100 (모두 singapore-hollandvillage). `rain`은 scene-1094의 "after rain" 1건뿐이고 이 장면은 이미 Night에 포함됨. **참고:** ① 야간 제외 시 mini는 7개 장면만 남고 Holland Village 지역이 통째로 빠짐. ② 비가 오는 중인 장면은 mini에 없음(전체 데이터에서는 키프레임의 19.4%가 비, 11.6%가 야간 [P1]). ③ "after rain"처럼 비가 그친 뒤도 걸리므로 단순 단어 검색이면 과하게 제외될 수 있음. 사진 눈 확인은 미실시 | [D1], [P1], 2026-10-07 |
| 3 | 후방 카메라 이름 | CAM_BACK, CAM_BACK_LEFT, CAM_BACK_RIGHT | A1 | `nusc.sensor` 출력 | ✅ | 일치. 전체 센서 채널 12개: CAM_FRONT/FRONT_LEFT/FRONT_RIGHT/BACK/BACK_LEFT/BACK_RIGHT, LIDAR_TOP, RADAR 5개. 정후방 CAM_BACK은 화각 110°, 나머지 카메라는 70° [P1] | [D1], [P1], 2026-10-07 |
| 4 | 키프레임(라벨) 주기 | 약 2Hz | A2 | 공식 웹사이트 데이터 설명 | ✅ | 2Hz로 일치 ("A sample is an annotated keyframe at 2 Hz"). 카메라 자체 촬영 주기는 12Hz | [S1], [P1], 2026-10-07 |
| 5 | 카테고리 이름 | vehicle.car, vehicle.bus.bendy 등 | A3 | `list_categories()` 결과와 보고서 A3 표 대조 | ✅ | 23개 카테고리. A3 표의 10개 이름(vehicle.car, vehicle.emergency.police, vehicle.bus.bendy, vehicle.bus.rigid, vehicle.truck, vehicle.trailer, vehicle.construction, vehicle.emergency.ambulance, vehicle.motorcycle, vehicle.bicycle) 모두 실제 이름과 철자 일치 | [D1], [S2], 2026-10-07 |
| 6 | 3D→2D 박스 변환 스크립트 제공 여부 | devkit에 제공 | A4 | GitHub 저장소 스크립트 폴더 확인 | ✅ | `python-sdk/nuscenes/scripts/export_2d_annotations_as_json.py` 존재. 단, 이 폴더는 "핵심 코드가 아닌 기타 스크립트(Misc scripts)"로 분류됨 | [G1], 2026-10-07 |
| 7 | visibility 등급 구간 | 최하위 등급이 0~40% | A5 | `nusc.visibility` 출력 | ✅ | 4등급: 1=v0-40, 2=v40-60, 3=v60-80, 4=v80-100. 기준은 "카메라 6대 이미지 전체에서 보이는 비율"이며, 후방 카메라 한 대 기준 가시성이 아님에 유의 | [D1], [S1], [S2], 2026-10-07 |
| 8 | 박스별 라이다 점 개수 정보 | 제공됨 | A5 | `sample_annotation[0]`에서 `num_lidar_pts` 필드 확인 | ✅ | `num_lidar_pts`, `num_radar_pts` 필드 존재. mini 정답 박스 18,538개 중 4,278개(23.1%)는 라이다 점 0개 | [D1], [S1], 2026-10-07 |
| 9 | 카메라 이미지 크기 | 약 1600×900 | A7 | 사진 한 장 열어 크기 출력 | ✅ | 정확히 1600×900. mini의 모든 jpg 기록이 같은 크기 | [D1], [P1], 2026-10-07 |
| 10 | 수집 도시와 통행 방향 | 보스턴(우측 통행), 싱가포르(좌측 통행) | A8 | 공식 웹사이트 또는 nuScenes 논문 | ✅ | 보스턴(Seaport, South Boston), 싱가포르(One North, Holland Village, Queenstown). 논문에 "right versus left-hand traffic" 차이 명시. mini의 location 값: boston-seaport, singapore-onenorth, singapore-queenstown, singapore-hollandvillage | [P1], [D1], 2026-10-07 |
| 11 | 공식 train/val 분할 제공 여부 | 장면 단위 공식 분할 제공 | A6 | devkit의 분할 관련 코드 또는 문서 | ✅ | `nuscenes/utils/splits.py`에 장면 단위로 정의. 전체: train 700 / val 150 / test 150. mini: mini_train 8개, mini_val 2개(scene-0103, scene-0916) | [G2], 2026-10-07 |
| 12 | 3D 박스 위치의 기준점 | 차량 중심점 | C6 | 공식 웹사이트 데이터 형식 설명 | ✅ | `translation` = "center_x, center_y, center_z" (박스의 3D 중심, 전역 좌표계·미터 단위). 바닥면이 아니라 높이 방향으로도 중심임 | [S1], 2026-10-07 |
| 13 | 카메라 내부·외부 파라미터 제공 여부 | 제공됨 | C0 | `nusc.calibrated_sensor` 출력 | ✅ | `calibrated_sensor` 120개 기록 중 카메라 60개 모두 3×3 `camera_intrinsic` 보유. 외부 파라미터는 `translation`·`rotation`(차량 좌표계 기준) | [D1], [S1], 2026-10-07 |
| 14 | 카메라 장착 높이 | 1.5m 이상 | A8, C6 | 13번 외부 파라미터의 높이값 | ✅ | z값: CAM_BACK 1.568~1.579m, CAM_BACK_LEFT 1.562~1.591m, CAM_BACK_RIGHT 1.551~1.562m (참고: CAM_FRONT 1.495~1.511m, LIDAR_TOP 1.84m). 단, 이 값은 차량 좌표계(뒤 차축 중심) 기준이며, ego_pose의 z가 모두 0이라 지면 높이로 간주해 쓰는 것이 일반적임 | [D1], 2026-10-07 |
| 15 | 번호판·얼굴 비식별화 여부 | 확인 필요 | 이슈 6 | 공식 웹사이트, 사진 직접 확인 | ✅ | 비식별화 적용됨. 검출 모델로 얼굴·번호판을 찾아 블러 처리(재현율 우선으로 임계값 설정). CAM_BACK 사진 1장 확인 시 뒤차 번호판 판독 불가. 자동 검출이므로 누락 가능성은 남음 | [P1], [D1], 2026-10-07 |
| 16 | 라이선스와 이용 조건 | 비상업적 이용 조건으로 기억 | 전체 | 공식 웹사이트 이용 약관 원문 | ✅ | 데이터: CC BY-NC-SA 4.0(비상업·출처 표시·동일 조건 변경 허락). 상업적 이용은 별도 상업 라이선스(nuScenes@motional.com). devkit 코드는 Apache 2.0. **약관 페이지([S3])는 스크립트로 렌더링되어 직접 읽지 못했고, 2차 자료([W1], [W2])로 확인함 → 원문 직접 열람 권장** | [W1], [W2], [G3], 2026-10-07 |

### 출처

| 표기 | 출처 |
|---|---|
| D1 | nuScenes v1.0-mini 실제 메타데이터(`v1.0-mini/*.json`)와 CAM_BACK 사진. 공식 배포 파일 `https://www.nuscenes.org/data/v1.0-mini.tgz`에서 추출해 JSON을 직접 읽음(devkit 미사용) |
| S1 | [devkit 문서 schema_nuscenes.md](https://github.com/nutonomy/nuscenes-devkit/blob/master/docs/schema_nuscenes.md) |
| S2 | [devkit 문서 instructions_nuscenes.md](https://github.com/nutonomy/nuscenes-devkit/blob/master/docs/instructions_nuscenes.md) |
| S3 | [nuScenes 이용 약관](https://www.nuscenes.org/terms-of-use) |
| G1 | [devkit scripts 폴더](https://github.com/nutonomy/nuscenes-devkit/tree/master/python-sdk/nuscenes/scripts) |
| G2 | [devkit splits.py](https://github.com/nutonomy/nuscenes-devkit/blob/master/python-sdk/nuscenes/utils/splits.py) |
| G3 | [devkit LICENSE.txt](https://github.com/nutonomy/nuscenes-devkit/blob/master/LICENSE.txt) |
| P1 | Caesar et al., "nuScenes: A multimodal dataset for autonomous driving", CVPR 2020 ([arXiv:1903.11027](https://arxiv.org/abs/1903.11027)) |
| W1 | [Segments.ai, The nuScenes dataset for autonomous driving](https://segments.ai/blog/dataset/nuscenes-by-motional/) |
| W2 | [Motional nuScenes 페이지](https://motional.com/nuscenes) |

---

## 4. 확인 후 할 일

1. 각 항목의 상태, 확인 결과, 출처·확인일을 채운다.
2. ✏️ 수정 필요 항목은 설계 보고서 본문을 고치고, 고친 위치를 아래 변경 기록에 남긴다.
3. 모두 확인되면 설계 보고서를 v0.2로 올리고, 0장의 "기억에 기반한 내용" 참고 문구를 "공식 자료로 확인 완료(확인일)"로 바꾼다.
4. 16번 라이선스 결과에 따라 포트폴리오에 공개할 수 있는 범위(사진, 영상, 가공 데이터)를 정한다.

## 5. 변경 기록

| 날짜 | 확인 항목 # | 변경 내용 | 보고서 수정 위치 |
|---|---|---|---|
| 2026-10-11 | 1~16 | 0장의 "기억에 기반한 내용" 참고 문구를 "확인 완료(2026-10-07)"로 교체, 문서 버전 v0.2 | 0장 |
| 2026-10-11 | 2 | 야간은 `Night`로 시작하는 장면만 제외, 우천은 단어 검색 대신 눈으로 확인. 야간 제외 시 학습 장면 8개 → 5개 감소 명시 | A1 |
| 2026-10-11 | 6 | 2D 변환 스크립트 경로 명시, "제공 여부 확인 필요" 삭제 | A4 |
| 2026-10-11 | 7 | 가시성 등급이 카메라 6대 전체 기준이라는 주의 추가 | A5 |
| 2026-10-11 | 11 | mini(mini_train 8 / mini_val 2)와 본 데이터(train 700 / val 150) 분할 명시 | A6 |
| 2026-10-11 | 12 | 정답 위치를 카메라 쪽 면으로 옮기는 것에 더해 높이 방향으로도 바닥까지 내리도록 수정 | C6 |
| 2026-10-11 | 4·9·14 | 조사 결과 보고서 3.1의 "확인 필요" 값을 확인된 값으로 교체 (1600×900, 12Hz·2Hz, 1.57m) | 조사 결과 보고서 3.1 |