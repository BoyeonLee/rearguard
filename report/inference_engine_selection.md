# RearGuard 추론 엔진 선정 보고서: ONNX Runtime · NCNN · OpenVINO · TFLite(LiteRT)

> 기반 문서: PRD v0.3(1.2 최종 제품 구상, 6.2 성공지표), 검출 모델 선정 및 학습·검증 설계 보고서 v0.3(`model_training_validation_design.md`), 엔진 벤치마크(`../engine-bench/README.md`)
> 문서 버전: v0.1 / 작성일: 2026-10-15
> 목적: YOLO26n을 ONNX로 내보낸 뒤 어떤 추론 엔진으로 실행할지 정한다. **판단 기준은 PoC(노트북)가 아니라 출시 시점의 실행 환경인 스마트폰 앱**이다.

---

## 0. 결론 요약

| 엔진 | 스마트폰 적합도 | 한 줄 평가 | 판단 |
|---|---|---|---|
| **TFLite (LiteRT)** | ◎ | Android 기본 엔진. GPU·NPU 가속, iOS 지원, Ultralytics 공식 내보내기 | **채택** |
| NCNN | ○ | ARM CPU·Vulkan GPU에 강하고 가벼움. NPU 미지원, C++/JNI 직접 연동 필요 | 차선책 |
| ONNX Runtime | △ | 모델을 그대로 쓸 수 있으나 Android GPU 가속이 약하고 NPU는 칩 제조사별 | PoC·검증 기준용 |
| OpenVINO | ✕ | Intel 하드웨어 전용 최적화. 스마트폰 GPU·NPU 미지원 | 불채택 |

**한 줄로:** "출시용 스마트폰 앱의 추론 엔진은 **TFLite(LiteRT)** 로 한다. ONNX는 모델 교환·정확도 검증 기준 형식으로만 남긴다."

---

## 1. 판단 기준

| # | 기준 | 이유 |
|---|---|---|
| ① | 스마트폰에서 파이프라인 전체 15 FPS 이상, 프레임→LED 200ms 이하 | PRD 6.2 성공지표를 출시 환경에서도 유지 |
| ② | 모바일 GPU·NPU 가속 지원 | 주행 중 장시간 동작 → CPU만 쓰면 발열·배터리 소모로 FPS가 떨어짐(PRD: 30분 후 저하 ≤20%) |
| ③ | Android·iOS 모두 지원 | "라이더가 이미 가진 스마트폰" 활용이 제품 핵심(PRD 1.2) |
| ④ | YOLO26n 변환 경로가 안정적이고 정확도 손실이 없음 | 재학습 때마다 반복할 작업 |
| ⑤ | 앱 연동 난이도·앱 용량 | 소규모 팀이 유지보수 가능해야 함 |

---

## 2. 벤치마크 결과 (참고: 노트북 x86 CPU)

같은 YOLO26n(FP32, 640×640), coco128 100장, CPU 4스레드, 3회 측정 중앙값. 상세는 `engine-bench/README.md`.

| 엔진 | 추론 평균 | FPS | 로딩 시간 | mAP50-95 | 모델 용량 |
|---|---:|---:|---:|---:|---:|
| **TFLite (LiteRT)** | **57.1 ms** | **17.5** | 171 ms | 0.4668 | 9.51 MB |
| ONNX Runtime | 80.8 ms | 12.4 | 186 ms | 0.4668 | 9.47 MB |
| OpenVINO | 85.8 ms | 11.6 | 960 ms | 0.4668 | 9.63 MB |
| NCNN | 98.4 ms | 10.2 | 251 ms | 0.4668 | 9.31 MB |

- **정확도는 4개 엔진이 완전히 같다.** ONNX 대비 출력 차이가 FP32 연산 오차 수준(박스 최대 0.02px)이라, 엔진 선택은 정확도가 아니라 **속도·가속기 지원·연동성**으로 결정된다.
- 이 수치는 x86 CPU 기준이다. 스마트폰은 ARM CPU + GPU/NPU 구성이므로 순위가 달라질 수 있다(특히 NCNN은 ARM에서 유리해짐). 다만 출시 환경에서 실제로 성능을 좌우하는 것은 CPU 속도보다 **GPU·NPU를 쓸 수 있느냐**다(§3).

---

## 3. 엔진별 핵심 비교 (스마트폰 기준)

| 항목 | TFLite (LiteRT) | NCNN | ONNX Runtime | OpenVINO |
|---|---|---|---|---|
| 개발사 | Google | Tencent | Microsoft | Intel |
| Android CPU | XNNPACK (ARM 최적화) | ARM NEON 최적화 (강점) | XNNPACK EP | ARM 플러그인 있음, 모바일 비주력 |
| Android GPU | **GPU 델리게이트 (OpenCL/OpenGL)** | Vulkan | 사실상 없음 | 미지원 |
| Android NPU | **Qualcomm·MediaTek NPU 가속 (LiteRT)** | 미지원 | NNAPI EP(NNAPI는 Android 15부터 지원 중단), Qualcomm 전용 QNN EP | 미지원 |
| iOS | Metal / Core ML 델리게이트 | Vulkan(MoltenVK)·CPU | Core ML EP | 미지원 |
| YOLO26n 변환 | Ultralytics `format="litert"` 공식 지원 (검증 완료) | Ultralytics `format="ncnn"` (PNNX) | ONNX 그대로 사용 | Ultralytics `format="openvino"` |
| 앱 연동 | Kotlin/Swift 공식 API, Google Play 서비스 런타임 사용 시 앱 용량 증가 거의 없음 | C++ 라이브러리 → JNI 직접 작성 | Java/Kotlin·Swift API 제공, 런타임 포함 시 앱 용량 증가 | 모바일 앱 연동 사례 거의 없음 |
| 양자화(INT8/FP16) | 변환 시 바로 지원, GPU는 FP16 | 지원 | 지원 | 지원(Intel 대상) |

### 엔진별 정리
- **TFLite (LiteRT)** — Android의 표준 온디바이스 엔진. 같은 모델 파일 하나로 CPU → GPU → NPU 순으로 가속기를 골라 쓸 수 있어 기기 편차가 큰 스마트폰 시장에 가장 맞다. x86 벤치마크에서도 가장 빨랐다. 단점은 ONNX→TFLite 변환 시 입력 형식(NCHW)·좌표 정규화가 달라지는 등 후처리를 맞춰야 한다는 점인데, `benchmark.py`에서 이미 처리해 정확도 동일함을 확인했다.
- **NCNN** — 모바일 YOLO 데모에서 많이 쓰이는 가볍고 빠른 엔진. Vulkan으로 제조사 구분 없이 GPU를 쓸 수 있다. 하지만 NPU를 쓸 수 없고, 공식 Kotlin/Swift API가 없어 JNI·전처리 코드를 직접 관리해야 한다. LiteRT 가속이 특정 기기에서 문제가 생길 때의 **차선책**으로 둔다.
- **ONNX Runtime** — PoC에서 쓰는 ONNX 파일을 변환 없이 그대로 쓸 수 있는 것이 최대 장점. 그러나 Android에서 범용 GPU 가속 경로가 없고, NPU는 지원 중단된 NNAPI나 Qualcomm 전용 QNN에 의존한다. 출시용으로는 가속 측면이 약해 **노트북 PoC와 정확도 기준(reference) 용도**로만 쓴다.
- **OpenVINO** — Intel CPU·GPU·NPU용 엔진으로 노트북 PoC에는 선택지가 되지만(PRD F1), 스마트폰의 ARM SoC·모바일 GPU·NPU를 지원하지 않는다. 로딩 시간도 약 1초로 가장 길다. **출시 기준으로 불채택.**

---

## 4. 결론

**출시용 스마트폰 앱에서는 TFLite(LiteRT)를 추론 엔진으로 사용하기로 했다.**

1. **가속기 지원이 가장 넓다.** 같은 `.tflite` 파일로 CPU(XNNPACK)·GPU 델리게이트·Qualcomm/MediaTek NPU를 모두 쓸 수 있어, 장시간 주행에서도 발열·배터리 부담을 줄이며 15 FPS·200ms 목표를 유지하기 유리하다.
2. **Android·iOS를 하나의 모델 형식으로 지원한다.** "이미 가진 스마트폰"을 쓰는 제품 특성상 기기 범위가 넓어야 한다.
3. **정확도 손실 없이 변환 경로가 검증됐다.** Ultralytics 공식 내보내기로 YOLO26n을 변환했고, ONNX와 mAP·출력이 동일했다. 노트북 벤치마크에서도 4개 엔진 중 가장 빨랐다(57.1 ms, 17.5 FPS).
4. **앱 연동·유지보수가 가장 쉽다.** 공식 Kotlin/Swift API와 Google Play 서비스 런타임 덕분에 JNI 작성이나 앱 용량 부담이 적다.

### 역할 분담
| 형식/엔진 | 역할 |
|---|---|
| ONNX + ONNX Runtime | 노트북 PoC 실행, 엔진 간 출력·정확도 비교의 기준 |
| **TFLite (LiteRT)** | **출시 앱 추론 엔진** (Android: GPU→NPU 우선, iOS: Metal/Core ML 델리게이트) |
| NCNN | LiteRT 가속이 특정 기기에서 불안정할 때의 차선책 |

### 남은 확인 사항
- 실제 스마트폰(중급 Android 1종 이상, iPhone 1종)에서 CPU/GPU/NPU별 FPS·지연·30분 발열 실측
- 입력 416 vs 640, FP16·INT8 양자화 후 mAP 하락폭 확인 (특히 30m 원거리 차량 재현율 ≥95% 유지 여부)
