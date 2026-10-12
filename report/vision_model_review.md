# RearGuard 비전 모델 검토 보고서: YOLOE · DINO-X · SAM 3 · SigLIP · OCR · MediaPipe (PoC)

> 기반 문서: PRD v0.3, 검출 모델 선정 및 학습·검증 설계 보고서 v0.3(`model_training_validation_design.md`), 데이터 전처리 설계 보고서 v0.2(`data_preprocessing_design.md`)
> 문서 버전: v0.2 / 작성일: 2026-10-12 (v0.2: 6종 모두 검토만 하고 사용하지 않기로 결정)
> 목적: 최근 많이 쓰이는 비전 모델 6종의 기능과 사용법을 정리하고, RearGuard PoC에 쓴다면 어디에 쓸 수 있는지, 장단점은 무엇인지 판단한다.

---

## 0. 결론 요약

| 모델 | 한 줄 설명 | RearGuard 실시간 경로(F1) | 쓴다면 가능한 오프라인 용도 | 판단 |
|---|---|---|---|---|
| **YOLOE** | 글자·예시 이미지로 찾을 물체를 바꿀 수 있는 실시간 YOLO | 대체 불필요 | 라벨링 초안, 번호판 위치 찾기(비식별화) | 검토만 (사용 안 함) |
| **DINO-X** | 클라우드 API로 쓰는 고성능 범용 검출 모델 | **불가** (클라우드, 지연) | 라벨링 초안 (비식별화 후) | 검토만 (사용 안 함) |
| **SAM 3** | 글자로 지정한 물체를 모두 찾아 픽셀 단위로 오려내는 모델 | **불가** (무거움) | 접지점(박스 아래 변) 정답 검증 | 검토만 (사용 안 함) |
| **SigLIP** | 이미지와 문장의 유사도로 분류하는 모델 | 불필요 | 테스트 사진 조건 분류(야간·우천 걸러내기), 차종 재확인 | 검토만 (사용 안 함) |
| **OCR** | 이미지 속 글자를 읽는 기술 | **사용하지 않음** | 사용하지 않음 | **불채택** |
| **MediaPipe** | 구글의 온디바이스 비전 도구 모음 | 대체 불필요 (차선책 수준) | 얼굴 비식별화(E3), 최종 제품(스마트폰) 이전 시 참고 | 검토만 (사용 안 함) |

**한 줄로:** "검출 모델은 **YOLO26n 하나로 충분하다.** 6종은 검토만 하고 실제로는 쓰지 않는다."

- 이유 1: PRD 선정 조건 ①(노트북 CPU에서 파이프라인 전체 15 FPS, 200ms 이하)을 YOLO26n보다 잘 만족하는 모델이 없다.
- 이유 2: RearGuard가 찾을 대상은 승용차·대형차·이륜차 3종으로 **고정**되어 있어, "아무 물체나 찾는" 능력(오픈 보캐뷸러리)이 실시간 경로에서는 필요 없다.
- 이유 3: 라벨링(E4), 비식별화(E3), 거리 계산의 기준점 검증(C1) 같은 오프라인 작업에 쓸 여지는 있지만, 이번 PoC에서는 도입하지 않고 **검토 기록으로만 남긴다.**

> 참고: 모델 수치와 사용법은 각 모델 공식 문서·저장소 기준이며(2026-10-12 조회, §8 출처), 라이브러리 버전에 따라 함수 이름·가중치 파일명이 바뀔 수 있다. 실제 사용 전 설치된 버전에서 확인한다.

---

## 1. 검토 기준

모델 선정 보고서 §1.1의 선정 조건을 그대로 쓰고, 보조 도구로서의 조건 두 가지를 추가한다.

| # | 조건 | 출처 |
|---|---|---|
| ① | 노트북 CPU에서 파이프라인 전체 15 FPS 이상, 프레임→LED 200ms 이하 | PRD 6.2 |
| ② | 30m 이내 차량 재현율 95% 이상 (작은 물체 검출) | PRD 6.2 |
| ③ | 박스 아래 변 위치가 정확할 것 (거리 계산 기준점) | 전처리 C1 |
| ④ | Colab 무료 환경, 적은 데이터로 사용 가능 | 모델 선정 §1.1 |
| ⑤ | 모든 추론은 로컬에서 수행 (클라우드 금지) | PRD 2.4 |
| ⑥ | 개인정보(번호판·얼굴)를 저장·외부 전송하지 않을 것 | PRD 5.2, 전처리 E3 |

---

## 2. YOLOE (Real-Time Seeing Anything)

### 2.1 기능
- **무엇인가:** Ultralytics에 통합된 YOLO 계열 모델로, 학습하지 않은 물체도 "찾을 이름"만 주면 검출·분할(segmentation)한다. 최근에는 YOLO26 구조를 바탕으로 한 **YOLOE-26**도 나왔다(NMS 없음).
- **세 가지 사용 방식**
  | 방식 | 설명 | 핵심 기술 |
  |---|---|---|
  | 글자 프롬프트 | `"truck"`, `"license plate"`처럼 이름을 주면 그 물체를 찾음 | RepRTA: 글자 임베딩을 다듬는 작은 네트워크. 추론 시 본체에 합쳐져 추가 비용이 거의 없음 |
  | 예시 이미지 프롬프트 | 찾고 싶은 물체에 박스를 그린 예시 사진을 주면 비슷한 물체를 찾음 | SAVPE |
  | 프롬프트 없음 | 내장 어휘로 보이는 물체를 전부 찾음 | LRPC |
- **특징:** 찾을 이름을 한 번 정하면 일반 YOLO와 같은 속도로 동작하고, 일반 YOLO처럼 파인튜닝·ONNX 내보내기도 된다.

### 2.2 사용 예시
```python
from ultralytics import YOLOE

model = YOLOE("yoloe-11s-seg.pt")          # YOLOE-26 가중치 이름은 설치 버전에서 확인
names = ["car", "truck", "bus", "motorcycle", "license plate"]
model.set_classes(names, model.get_text_pe(names))   # 찾을 대상을 글자로 지정

results = model.predict("rear_70cm_001.jpg", conf=0.25)
results[0].show()
```

### 2.3 RearGuard에 쓴다면
| 좋은 점 | 안 좋은 점 |
|---|---|
| Ultralytics 기반이라 YOLO26n과 **같은 코드·같은 내보내기 방식**을 쓸 수 있어 도입 비용이 가장 낮다 | 찾을 대상이 3종으로 고정된 RearGuard에서는 오픈 보캐뷸러리 장점이 실시간 경로에서 쓰이지 않는다 |
| `"license plate"` 프롬프트로 **번호판 위치를 학습 없이 찾아** 트랙 E3 비식별화에 쓸 수 있다 | 글자 임베딩 헤드·분할 헤드가 붙어 같은 크기의 YOLO26n보다 무겁다 → 조건 ① 여유가 줄어든다 |
| 트랙 E 42장의 **라벨링 초안**을 자동으로 만들어 사람은 수정만 하면 된다 (E4 1~2시간 → 단축) | 학습 없이 쓰는 성능은 파인튜닝한 전용 모델보다 낮다. 특히 먼 작은 차(조건 ②)에서 누락이 생길 수 있어 초안은 반드시 사람이 확인해야 한다 |
| 승용차/대형차 구분이 애매한 차(승합차, 소형 트럭)에 대해 프롬프트를 바꿔 가며 빠르게 확인해 볼 수 있다 | 프롬프트 문구에 따라 결과가 흔들린다("truck" vs "lorry" 등). 문구를 고정해 기록해야 재현된다 |

**판단:** 실시간 검출은 YOLO26n 유지. 라벨링 초안·번호판 위치 찾기에 쓸 수는 있지만, 이번 PoC에서는 **사용하지 않는다.**

---

## 3. DINO-X

### 3.1 기능
- **무엇인가:** IDEA Research가 만든 범용(오픈 월드) 물체 인식 모델로, Grounding DINO의 후속이다. 글자 프롬프트·예시 이미지 프롬프트·프롬프트 없음 방식을 모두 지원하고, 박스 외에 마스크·키포인트·물체 설명 문장까지 낼 수 있다.
- **버전:** 성능 위주의 **Pro**, 빠른 추론과 엣지 배포를 겨냥한 **Edge** 두 가지로 소개된다.
- **사용 방식:** 가중치가 공개되지 않아 **DINO-X 플랫폼의 클라우드 API**(API 토큰 필요, 신규 사용자 무료 할당량 있음)로만 쓴다.

### 3.2 사용 예시
```python
# pip install dds-cloudapi-sdk  (SDK 버전에 따라 경로·인자 이름이 다를 수 있음)
from dds_cloudapi_sdk import Config, Client
from dds_cloudapi_sdk.tasks.v2_task import V2Task

client = Client(Config("발급받은_API_토큰"))
task = V2Task(
    api_path="/v2/task/dinox/detection",
    api_body={
        "model": "DINO-X-1.0",
        "image": image_url_or_base64,            # 비식별화(E3)를 마친 이미지만 보낸다
        "prompt": {"type": "text", "text": "car.truck.bus.motorcycle"},
        "targets": ["bbox"],
        "bbox_threshold": 0.25,
    },
)
client.run_task(task)
print(task.result)   # 물체별 박스·점수·이름
```

### 3.3 RearGuard에 쓴다면
| 좋은 점 | 안 좋은 점 |
|---|---|
| 후보 중 **학습 없이 쓰는 정확도가 가장 높은 편**이라 라벨링 초안 품질이 좋다 | **클라우드 API라 조건 ⑤(로컬 추론)를 정면으로 위반**한다. 네트워크 왕복 시간 때문에 200ms 지연 목표도 못 맞춘다 → 실시간 경로에는 절대 쓸 수 없다 |
| GPU·설치 없이 노트북에서 API만 부르면 되어 Colab 세션 제약(조건 ④)과 무관하다 | 사진을 외부 서버로 보내야 하므로 **조건 ⑥(개인정보)** 에 걸린다. 반드시 E3 비식별화를 먼저 하고 보내야 한다 |
| 작고 먼 차, 가려진 차 같은 어려운 경우의 "두 번째 의견"으로 쓸 수 있다 | 무료 할당량을 넘으면 유료이고, 모델·API가 바뀌면 결과 재현이 어렵다 (PoC 기록 관리에 불리) |
| | 가중치가 없어 파인튜닝·ONNX 내보내기가 불가능하다 |

**판단:** 실시간 경로에는 쓸 수 없다. 비식별화된 사진의 라벨링 초안에 쓸 수는 있지만, 이번 PoC에서는 **사용하지 않는다.**

---

## 4. SAM 3 (Segment Anything with Concepts)

### 4.1 기능
- **무엇인가:** Meta가 2025-11-19에 공개한 분할 모델. 이전 SAM 1·2는 "점이나 박스를 찍은 그 물체 하나"만 오려냈지만, SAM 3는 **짧은 명사(예: `"truck"`)나 예시 이미지를 주면 이미지 속 해당 물체를 모두 찾아** 각각 마스크와 ID를 준다(Promptable Concept Segmentation).
- **영상 지원:** 검출기와 추적기가 영상 인코더를 공유하며, 추적기는 SAM 2 구조를 이어받아 영상에서 같은 물체를 계속 따라간다. 영상에서는 추적하는 물체 수에 비례해 계산량이 늘어난다.
- **크기:** 약 8억 4800만(848M) 파라미터. GPU 사용이 사실상 전제이고, 가중치는 Hugging Face에서 사용 승인을 받은 뒤 받는다(Meta 자체 라이선스).

### 4.2 사용 예시
```python
# 공식 저장소(facebookresearch/sam3) 기준. Colab GPU에서 실행
from PIL import Image
from sam3.model_builder import build_sam3_image_model
from sam3.model.sam3_image_processor import Sam3Processor

model = build_sam3_image_model()
processor = Sam3Processor(model)

image = Image.open("rear_70cm_001.jpg")
state = processor.set_image(image)
out = processor.set_text_prompt(state=state, prompt="car")
masks, boxes, scores = out["masks"], out["boxes"], out["scores"]

# 활용: 마스크에서 가장 아래쪽 픽셀(바퀴가 땅에 닿는 점)을 찾는다
```

### 4.3 RearGuard에 쓴다면
| 좋은 점 | 안 좋은 점 |
|---|---|
| **박스가 아닌 픽셀 단위 윤곽**을 주므로, 차량이 실제로 땅에 닿는 점을 박스 아래 변보다 정확히 알 수 있다 → 조건 ③ 검증에 딱 맞다. 트랙 C1(접지점 추출)의 오차가 "박스가 대충이라서"인지 "호모그래피가 틀려서"인지 나눠서 진단할 수 있다 | 848M 파라미터라 **노트북 CPU 실시간(조건 ①)은 불가능**하다. YOLO26n보다 수백 배 무겁다 |
| 영상 추적 기능으로 nuScenes 연속 키프레임에서 같은 차의 마스크를 이어 볼 수 있어, F2 TTC 검증 데이터를 점검할 때 도움이 된다 | Colab 무료 GPU에서도 메모리·시간이 빠듯할 수 있다. 사진 수가 적은 트랙 E(42장) 정도에만 현실적이다 |
| 대형차 옆면 윤곽이 나오므로 "자전거에 가까운 쪽 옆면" 기준의 측면 간격 계산(F2)을 정답 수준에서 확인할 수 있다 | 가중치 사용 승인 절차와 별도 저장소 설치가 필요해 준비 시간이 든다 |
| | 마스크는 그림자·반사도 차의 일부로 잡을 수 있어, 접지점 정답으로 쓸 때도 사람이 눈으로 확인해야 한다 |

**판단:** 실시간 경로에는 쓸 수 없다. 접지점 정답 만들기·박스 하단 오차 진단에 쓸 수는 있지만, 이번 PoC에서는 **사용하지 않는다.**

---

## 5. SigLIP / SigLIP 2

### 5.1 기능
- **무엇인가:** 구글이 만든 이미지-글자 모델. CLIP처럼 이미지와 문장을 같은 공간에 넣어 "이 사진이 이 문장과 얼마나 맞는지"를 점수로 낸다. CLIP의 소프트맥스 손실 대신 **시그모이드 손실**을 써서 학습 효율이 좋다. 2025년에 다국어·위치 정보가 강화된 **SigLIP 2**가 나왔다.
- **할 수 있는 일:** 학습 없이 분류(zero-shot classification), 이미지 검색, 그리고 다른 모델(VLM 등)의 이미지 인코더 역할.
- **크기:** Base(약 86M 이미지 인코더)부터 So400m(약 400M), Giant까지. 박스를 찾는 기능은 없다(사진 전체 또는 잘라낸 조각을 분류).

### 5.2 사용 예시
```python
from transformers import pipeline

clf = pipeline("zero-shot-image-classification", model="google/siglip2-base-patch16-224")
labels = ["a photo of a road in daytime", "a photo of a road at night", "a photo of a road in the rain"]
print(clf("rear_70cm_001.jpg", candidate_labels=labels))

# 차량 조각(crop)을 넣어 차종을 다시 확인할 수도 있다
print(clf(car_crop, candidate_labels=["a sedan", "a truck", "a bus", "a motorcycle"]))
```

### 5.3 RearGuard에 쓴다면
| 좋은 점 | 안 좋은 점 |
|---|---|
| 학습 없이 **촬영 조건 분류**가 된다. iPhone 테스트 사진 중 PoC 범위 밖(야간·우천, 역광 심한 사진)을 자동으로 표시해 걸러낼 수 있다 (PRD 5.1 범위 관리) | 박스를 찾지 못하므로 **검출 모델을 대체할 수 없다**. 검출 결과를 받아 2차로 쓰는 것만 가능하다 |
| 검출된 차를 잘라 넣으면 승용차/대형차 판정을 **두 번째 의견**으로 확인할 수 있다 (대형차 기준 2.0m 경고가 차종에 달려 있으므로 의미가 있음) | 차마다 한 번씩 추가 추론이 필요해 실시간에 넣으면 조건 ①을 깎아 먹는다. 차종 분류는 이미 YOLO26n이 함께 한다 |
| Hugging Face 한 줄로 쓸 수 있고 Base 크기는 CPU에서도 오프라인 작업에는 충분히 돈다 | 문장(프롬프트) 표현에 따라 점수가 크게 바뀐다. 30m 떨어진 작은 차 조각처럼 해상도가 낮으면 판정이 불안정하다 |
| nuScenes 장면 설명(description)이 있어도, 실제 사진이 설명과 맞는지 점검하는 데 쓸 수 있다 | nuScenes는 이미 메타데이터로 야간·우천 장면을 거를 수 있어(트랙 A1), 학습 데이터 쪽 이득은 작다 |

**판단:** 검출 모델을 대체할 수 없다. 촬영 조건 점검·차종 라벨 재확인에 쓸 수는 있지만, 이번 PoC에서는 **사용하지 않는다.**

---

## 6. OCR (광학 문자 인식)

### 6.1 기능
- **무엇인가:** 이미지 속 글자 영역을 찾고(검출) 그 글자를 읽는(인식) 기술. 하나의 모델이 아니라 기술 분야이며, 대표 도구는 아래와 같다.
  | 도구 | 특징 |
  |---|---|
  | PaddleOCR 3.x (PP-OCRv5) | Apache 2.0, 정확도가 높은 편, 1억 파라미터 미만 경량 모델, CPU에서는 상대적으로 무거움 |
  | EasyOCR | 설치·사용이 가장 쉬움, 한국어 지원, 빠르게 데모 만들기 좋음 |
  | Tesseract | 오래된 표준 도구, 문서용. 도로 사진에는 약함 |
- **차량 분야 대표 용도:** 번호판 인식(ANPR/LPR).

### 6.2 사용 예시
```python
import easyocr

reader = easyocr.Reader(["ko", "en"], gpu=False)
for box, text, conf in reader.readtext("sign.jpg"):
    print(text, conf)
```

### 6.3 RearGuard에 쓴다면
| 좋은 점 | 안 좋은 점 |
|---|---|
| (이론상) 번호판을 읽어 같은 차를 다시 식별할 수 있다 → 하지만 RearGuard 추적은 칼만 필터 + IoU로 충분하다 | **번호판 내용은 개인정보**다. PRD는 영상 저장·개인정보 처리를 비범위로 두고(5.2), 트랙 E3는 번호판을 흐리게 처리하도록 정했다. 번호판을 "읽는" 기능은 이 방향과 정반대다 (조건 ⑥ 위반) |
| (이론상) 도로 표지판·속도 제한을 읽어 위험도 가중치에 쓸 수 있다 | 후방 카메라에는 표지판이 뒷면으로 보여 읽을 글자가 거의 없다 |
| | 위험 판단(F2·F3)에 필요한 정보는 **위치·궤적·차종**이지 글자가 아니다. 넣을 이유가 없다 |
| | 30m 거리 번호판은 수 픽셀 크기라 읽히지도 않고, 매 프레임 OCR은 CPU 시간을 크게 잡아먹는다 (조건 ①) |

> 혼동 주의: 번호판 크기(국내 장형 520mm)로 거리를 교차 검증하는 아이디어는 번호판의 **위치와 크기**만 쓰므로 OCR(글자 읽기)이 필요 없다. 필요하다면 YOLOE의 `"license plate"` 검출로 충분하다.

**판단:** **불채택.** 비식별화(E3)에도 글자를 읽을 필요는 없고, 번호판 위치만 찾으면 된다.

---

## 7. MediaPipe

### 7.1 기능
- **무엇인가:** 구글이 만든 **온디바이스(기기 안에서 실행) AI 도구 모음**. 학습된 모델 + 전처리·후처리를 묶은 "Tasks" API로 Android·iOS·웹·Python에서 같은 방식으로 쓴다. 내부적으로 LiteRT(TensorFlow Lite) 모델을 실행한다.
- **주요 비전 기능:** 물체 검출(EfficientDet-Lite), 이미지 분류, 이미지 분할, 얼굴 검출·얼굴 랜드마크, 손 추적·손동작 인식, 사람 자세(포즈) 추정.
- **물체 검출 속도 참고(공식, Pixel 6 기준):** EfficientDet-Lite0(320×320) CPU int8 약 29ms, float32 약 61ms / GPU float32 약 28ms. COCO 80종을 검출하며 `car`·`truck`·`bus`·`motorcycle`이 포함된다.

### 7.2 사용 예시
```python
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

# 1) 차량 검출 (EfficientDet-Lite0)
det = vision.ObjectDetector.create_from_options(vision.ObjectDetectorOptions(
    base_options=python.BaseOptions(model_asset_path="efficientdet_lite0.tflite"),
    score_threshold=0.4,
    category_allowlist=["car", "truck", "bus", "motorcycle"],
))
res = det.detect(mp.Image.create_from_file("rear_70cm_001.jpg"))
for d in res.detections:
    print(d.categories[0].category_name, d.bounding_box)

# 2) 얼굴 검출 → 비식별화(E3)에 사용
face = vision.FaceDetector.create_from_options(vision.FaceDetectorOptions(
    base_options=python.BaseOptions(model_asset_path="blaze_face_short_range.tflite")))
faces = face.detect(mp.Image.create_from_file("rear_70cm_001.jpg")).detections
```

### 7.3 RearGuard에 쓴다면
| 좋은 점 | 안 좋은 점 |
|---|---|
| **얼굴 검출이 가볍고 정확해** 트랙 E3 비식별화(얼굴 흐리기)를 CPU에서 바로 처리할 수 있다 | 기본 얼굴 검출 모델은 근거리 셀카용이라, 길가의 작은 얼굴은 놓칠 수 있다. 흐리기 결과는 눈으로 최종 확인해야 한다 |
| 처음부터 **스마트폰용**으로 설계되어, PRD 1.2의 최종 제품(스마트폰 앱) 구상과 방향이 맞는다. 카메라 입력·전처리 파이프라인을 그대로 옮길 수 있다 | PoC는 노트북 기준이라(PRD 1.1) 이 장점은 지금 당장 쓰이지 않는다 |
| EfficientDet-Lite0는 공식 CPU 측정값이 있는 가벼운 검출기라 YOLO26n이 속도를 못 맞출 때 비교해 볼 수는 있다 | EfficientDet-Lite0의 정확도(COCO AP 약 25 수준)는 YOLO26n(40.9)보다 크게 낮아 **조건 ②·③에서 불리**하다. 입력 320에서 30m 차는 너무 작다 |
| | 파인튜닝 도구(Model Maker)의 지원이 예전보다 줄어, nuScenes로 다시 학습하는 과정(조건 ④)이 Ultralytics보다 번거롭다 |
| | 손·포즈·얼굴 랜드마크 등 대부분의 기능은 후방 차량 경고와 관련이 없다 |

**판단:** 실시간 검출은 YOLO26n 유지. 얼굴 비식별화에 쓸 수는 있지만, 이번 PoC에서는 **사용하지 않는다.** 최종 제품 구상 단계에서 온디바이스 실행 방식의 참고로만 남긴다.

---

## 8. 정리: RearGuard 파이프라인에서의 위치

```
[실시간 경로: 노트북 CPU]  ← 변경 없음
 프레임 → YOLO26n(F1) → 칼만 추적 → 호모그래피 거리(F2) → 위험도(F3) → BLE

[오프라인 작업]  ← 변경 없음 (6종 모두 사용하지 않음)
 트랙 E 촬영·비식별화·라벨링, 박스 하단 오차 검증은 기존 설계대로 진행한다.
```

### 8.1 조건별 비교

| 조건 | YOLOE | DINO-X | SAM 3 | SigLIP | OCR | MediaPipe |
|---|---|---|---|---|---|---|
| ① 노트북 CPU 실시간 | △ (YOLO26n보다 무거움) | ✕ (클라우드) | ✕ (848M) | △ (검출 불가, 2차 분류만) | ✕ | ○ |
| ② 30m 작은 차 | △ | ○ | ○ (GPU 전제) | – | – | ✕ |
| ③ 박스 하단 정확도 | △ | ○ | **◎ (픽셀 마스크)** | – | – | ✕ |
| ④ Colab·적은 데이터 | ○ (학습 없이 사용) | ○ (설치 불필요) | △ (GPU 메모리) | ○ | ○ | △ (재학습 번거로움) |
| ⑤ 로컬 추론 | ○ | **✕** | ○ | ○ | ○ | ○ |
| ⑥ 개인정보 | ○ (번호판 흐리기에 도움) | △ (비식별화 후에만) | ○ | ○ | **✕ (번호판 읽기)** | ○ (얼굴 흐리기에 도움) |

### 8.2 결론

1. 검출 모델은 YOLO26n 하나로 진행한다. 6종 중 YOLO26n을 대체하거나 보완해야 할 모델은 없다.
2. 6종은 이번 PoC에서 사용하지 않는다. 라벨링·비식별화·접지점 검증에서 사람이 직접 하기 어려운 문제가 생기면, 이 문서의 "쓴다면 가능한 오프라인 용도"를 다시 참고한다.

---

## 9. 출처 (2026-10-12 조회)

- YOLOE: Ultralytics 문서 https://docs.ultralytics.com/models/yoloe , YOLOE-26 튜토리얼 https://pyimagesearch.com/2026/08/24/yolo26-open-vocabulary-object-detection-with-yoloe-26/ , 관련 논문 https://arxiv.org/pdf/2602.00168
- DINO-X: 공식 MCP 서버 소개 https://mcpservers.org/servers/IDEA-Research/DINO-X-MCP , 모델 소개 https://ai-bot.cn/dino-x/
- SAM 3: 논문 https://arxiv.org/pdf/2511.16719 , 공식 저장소 https://github.com/facebookresearch/sam3 , 해설 https://blog.roboflow.com/what-is-sam3/
- SigLIP 2: Hugging Face 모델 카드 https://huggingface.co/google/siglip2-so400m-patch14-224
- OCR: PaddleOCR 3.0 기술 보고서 https://arxiv.org/abs/2507.05595 , PaddleOCR vs EasyOCR https://codesota.com/ocr/paddleocr-vs-easyocr
- MediaPipe: Object Detector 공식 문서 https://developers.google.com/edge/mediapipe/solutions/vision/object_detector
